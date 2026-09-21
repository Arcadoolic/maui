-- Bundled with mame-awesome-ui (see boServer.ts's startMameConfigSession()/captureOnePress()).
-- Launched as a real, visible MAME window (not headless) that an admin explicitly starts and
-- stops from the BO's "Configuration globale des entrées" card, and keeps focused while pressing
-- buttons - like most SDL apps, MAME only receives joystick input while it has OS focus. Runs for
-- as long as the admin leaves it open, serving any number of captures without relaunching MAME
-- (and, just as importantly, without device indices like JOYCODE_1 vs JOYCODE_2 shifting between
-- captures - those are assigned fresh at every MAME launch, so several short-lived one-shot
-- launches - the previous approach - could each see a different index for the very same
-- controller). Closed explicitly (see stopMameConfigSession()) rather than any idle timeout - that
-- auto-close was the source of the last approach's own reliability problems (a wedged session
-- silently breaking every future capture instead of cleanly exiting), so this drops it entirely.
--
-- File-based request/response, polled once a frame (no way to signal an already-running MAME
-- process from Node otherwise short of a full IPC layer, which felt like overkill here):
--   request.txt - written by captureOnePress() with a fresh nonce every time an admin clicks
--                 "Capturer" on some action's row. Read every frame; a nonce different from the
--                 last one seen arms the daemon for the very next press, whatever it turns out to
--                 be (the daemon has no idea which cfg action a nonce is for - only Node does, via
--                 its own nonce -> portType bookkeeping).
--   result.txt  - written by this script as "<nonce>|<token>" the moment the armed press happens;
--                 captureOnePress() polls for this and deletes it once consumed.

local CAPTURE_DIR = [[__CAPTURE_DIR__]]
local REQUEST_PATH = CAPTURE_DIR .. '/request.txt'
local RESULT_PATH = CAPTURE_DIR .. '/result.txt'

local ANALOG_AXIS_TOKENS = {
    XAXIS = true, YAXIS = true, ZAXIS = true,
    RXAXIS = true, RYAXIS = true, RZAXIS = true,
    SLIDER1 = true, SLIDER2 = true, DIAL = true,
}

local input = manager.machine.input
local joystick_class = input.device_classes.joystick
local candidates = {}

if joystick_class then
    for device_index, device in pairs(joystick_class.devices) do
        for _, item in pairs(device.items) do
            local base = 'JOYCODE_' .. device_index .. '_' .. item.token
            local tokens = ANALOG_AXIS_TOKENS[item.token]
                and {base .. '_POS_SWITCH', base .. '_NEG_SWITCH'}
                or {base}
            for _, token in ipairs(tokens) do
                local ok, code = pcall(function() return input:code_from_token(token) end)
                if ok and code then
                    table.insert(candidates, {token = token, code = code})
                end
            end
        end
    end
end

local function read_file(path)
    local f = io.open(path, 'r')
    if not f then
        return nil
    end
    local content = f:read('*a')
    f:close()
    return content
end

local function write_file(path, content)
    local f = io.open(path, 'w')
    if f then
        f:write(content)
        f:close()
    end
end

-- Dumps MAME's effective sequence for every UI_* port (its own defaults plus whatever default.cfg
-- already overrides) once at startup, one "<PORT_TYPE>|<sequence>" line each. Node reads it to find
-- default bindings a newly captured button would collide with - e.g. UI_MENU (the in-game config
-- menu) is bound to JOYCODE_1_BUTTON9 out of the box, so a cabinet button remapped to quit MAME
-- would open that menu at the same time. Never guessed from a hardcoded table: defaults differ
-- between MAME versions.
local UI_SEQS_PATH = CAPTURE_DIR .. '/ui-seqs.txt'

local function dump_ui_seqs()
    local lines = {}
    for _, port_type in pairs(manager.machine.ioport.types) do
        local token = tostring(port_type.token or port_type.type)
        if token:find('^UI_') then
            local ok, seq = pcall(function()
                return input:seq_to_tokens(manager.machine.ioport:type_seq(port_type.type, port_type.player or 0, 'standard'))
            end)
            if ok and seq then
                table.insert(lines, token .. '|' .. seq)
            end
        end
    end
    write_file(UI_SEQS_PATH, table.concat(lines, '\n') .. '\n')
end

local dump_ok, dump_err = pcall(dump_ui_seqs)
if not dump_ok then
    io.stderr:write('[capture-daemon] ui-seqs dump error: ' .. tostring(dump_err) .. '\n')
end

-- Dumps the running game's remappable input fields (directions, buttons, coin, start) once at
-- startup, one "<PORT_TYPE>|<tag>|<mask>|<defvalue>|<default sequence>|<field name>" line each - see
-- MameCfg.ts's parseGameFields(). A per-game cfg <port> only takes effect when it carries the exact
-- tag/mask/defvalue of the field it targets, and only MAME knows those, so the per-game remap card
-- writes them back verbatim from here. The port type token (what a cfg's <port type="..."> holds)
-- comes from ioport.types, keyed by numeric type + player.
local GAME_FIELDS_PATH = CAPTURE_DIR .. '/game-fields.txt'

local function is_remappable(token)
    return token:find('^P[1-4]_JOYSTICK_UP$') or token:find('^P[1-4]_JOYSTICK_DOWN$')
        or token:find('^P[1-4]_JOYSTICK_LEFT$') or token:find('^P[1-4]_JOYSTICK_RIGHT$')
        or token:find('^P[1-4]_BUTTON%d+$')
        or token:find('^COIN[1-4]$') or token:find('^START[1-4]$')
end

local function dump_game_fields()
    local tokens = {}
    for _, port_type in pairs(manager.machine.ioport.types) do
        tokens[port_type.type .. '/' .. (port_type.player or 0)] = tostring(port_type.token)
    end
    local lines = {}
    for _, port in pairs(manager.machine.ioport.ports) do
        for name, field in pairs(port.fields) do
            local token = tokens[field.type .. '/' .. field.player]
            if token and is_remappable(token) then
                local ok, default_seq = pcall(function()
                    return input:seq_to_tokens(field:default_input_seq('standard'))
                end)
                table.insert(lines, string.format('%s|%s|%d|%d|%s|%s',
                    token, port.tag, field.mask, field.defvalue, ok and default_seq or '', name))
            end
        end
    end
    write_file(GAME_FIELDS_PATH, table.concat(lines, '\n') .. '\n')
end

local fields_ok, fields_err = pcall(dump_game_fields)
if not fields_ok then
    io.stderr:write('[capture-daemon] game-fields dump error: ' .. tostring(fields_err) .. '\n')
end

local last_seen_request = nil
local armed_nonce = nil

-- Wrapped in pcall: a candidate's code can go bad mid-session (e.g. its controller gets
-- unplugged) - logged to stderr and skipped rather than left to crash the whole callback, which
-- would otherwise silently stop it from ever running again while MAME itself stays open.
emu.register_periodic(function()
    local ok, err = pcall(function()
        local request = read_file(REQUEST_PATH)
        if request and request ~= last_seen_request then
            last_seen_request = request
            armed_nonce = request
        end

        if armed_nonce then
            for _, candidate in ipairs(candidates) do
                if input:code_pressed(candidate.code) then
                    write_file(RESULT_PATH, armed_nonce .. '|' .. input:code_to_token(candidate.code))
                    armed_nonce = nil
                    break
                end
            end
        end
    end)
    if not ok then
        io.stderr:write('[capture-daemon] periodic callback error: ' .. tostring(err) .. '\n')
    end
end)
