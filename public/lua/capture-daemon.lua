-- Bundled with mame-awesome-ui (see boServer.ts's startMameConfigSession()/captureOnePress()).
-- Launched as a real, visible MAME window (not headless) that an admin explicitly starts and
-- stops from the BO's remap cards. It is launched with -background_input (see boServer.ts), since
-- MAME otherwise ignores joystick input while its window isn't focused - which it never is when
-- the BO runs in a browser on the same machine. Runs for
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
--                 "Capturer" on some action's row, followed by "|axis" when what is wanted is an
--                 axis moved (a spinner, a mouse, a stick) rather than a button pressed. Read every frame; a nonce different from the
--                 last one seen arms the daemon for the very next press, whatever it turns out to
--                 be (the daemon has no idea which cfg action a nonce is for - only Node does, via
--                 its own nonce -> portType bookkeeping).
--   result.txt  - written by this script as "<nonce>|<token>" the moment the armed press happens;
--                 captureOnePress() polls for this and deletes it once consumed.
--   apply.txt   - written by applyGameFieldLive() as "<nonce>|<tag>|<mask>|<sequence>|<type>" to
--                 rebind one of the running game's fields right away (empty sequence: back to its
--                 default, NONE: no control at all; type: standard, increment or decrement),
--                 so a capture works without relaunching MAME - which also saves it to the game's
--                 cfg on exit, like a change made from its own menu.
--   applied.txt - "<nonce>|ok" or "<nonce>|<error>", this script's answer to apply.txt.
--
-- Also run by every game MAUI launches (MameService.startGame()), so the BO can configure the game
-- being played: the request files are only read every few frames to keep that cheap.

local CAPTURE_DIR = [[__CAPTURE_DIR__]]
local REQUEST_PATH = CAPTURE_DIR .. '/request.txt'
local RESULT_PATH = CAPTURE_DIR .. '/result.txt'
local APPLY_PATH = CAPTURE_DIR .. '/apply.txt'
local APPLIED_PATH = CAPTURE_DIR .. '/applied.txt'
-- The request files are read once every POLL_FRAMES callbacks (~4 times a second at 60 Hz); an
-- armed capture still checks the gamepad on every one.
local POLL_FRAMES = 15

local ANALOG_AXIS_TOKENS = {
    XAXIS = true, YAXIS = true, ZAXIS = true,
    RXAXIS = true, RYAXIS = true, RZAXIS = true,
    SLIDER1 = true, SLIDER2 = true, DIAL = true,
}

local input = manager.machine.input
local joystick_class = input.device_classes.joystick
local candidates = {}
-- What an "|axis" capture watches: every joystick axis (absolute, -65536..65536) and the mouse's
-- X/Y (relative: how far it moved since the last frame, 512 per pixel).
local axis_candidates = {}

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
            if ANALOG_AXIS_TOKENS[item.token] then
                table.insert(axis_candidates, {code = item.code, relative = false})
            end
        end
    end
end

-- Keyboard keys and mouse buttons too (not the mouse's axes: moving it to reach a window would be
-- taken for the press). Unlike a gamepad, they only reach MAME while its window is in front:
-- -background_input doesn't cover them on SDL (Linux, macOS).
for _, class_name in ipairs({'keyboard', 'mouse'}) do
    local class = input.device_classes[class_name]
    if class then
        for _, device in pairs(class.devices) do
            for _, item in pairs(device.items) do
                if class_name == 'keyboard' or item.token:find('^BUTTON%d+$') then
                    table.insert(candidates, {code = item.code})
                elseif item.token == 'XAXIS' or item.token == 'YAXIS' then
                    table.insert(axis_candidates, {code = item.code, relative = true})
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

-- ioport.types is walked with ipairs, never pairs: on MAME 0.289 (Homebrew, macOS arm64) pairs()
-- runs past the end of the list and crashes MAME (see input-defaults.lua).
local function dump_ui_seqs()
    local lines = {}
    for _, port_type in ipairs(manager.machine.ioport.types) do
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

-- Same list as MameCfg.ts's ANALOG_PORT_TYPE.
local ANALOG_TYPES = {
    'DIAL', 'DIAL_V', 'PADDLE', 'PADDLE_V', 'TRACKBALL_X', 'TRACKBALL_Y', 'POSITIONAL', 'POSITIONAL_V',
    'AD_STICK_X', 'AD_STICK_Y', 'AD_STICK_Z', 'PEDAL', 'PEDAL2', 'PEDAL3',
}

local function is_analog_type(token)
    for _, analog in ipairs(ANALOG_TYPES) do
        if token:find('^P[1-4]_' .. analog .. '$') then
            return true
        end
    end
    return false
end

local function is_remappable(token)
    return token:find('^P[1-4]_JOYSTICK_UP$') or token:find('^P[1-4]_JOYSTICK_DOWN$')
        or token:find('^P[1-4]_JOYSTICK_LEFT$') or token:find('^P[1-4]_JOYSTICK_RIGHT$')
        or token:find('^P[1-4]_BUTTON%d+$')
        or token:find('^COIN[1-4]$') or token:find('^START[1-4]$')
        or is_analog_type(token)
end

-- Analog fields also get a "<tag>|<mask>|<increment sequence>|<decrement sequence>" line in
-- game-analog.txt: the keys that move them each way.
local GAME_ANALOG_PATH = CAPTURE_DIR .. '/game-analog.txt'

local function dump_game_fields()
    local tokens = {}
    for _, port_type in ipairs(manager.machine.ioport.types) do
        tokens[port_type.type .. '/' .. (port_type.player or 0)] = tostring(port_type.token)
    end
    local lines = {}
    local analog_lines = {}
    for _, port in pairs(manager.machine.ioport.ports) do
        for name, field in pairs(port.fields) do
            local token = tokens[field.type .. '/' .. field.player]
            if token and is_remappable(token) then
                local ok, default_seq = pcall(function()
                    return input:seq_to_tokens(field:default_input_seq('standard'))
                end)
                table.insert(lines, string.format('%s|%s|%d|%d|%s|%s',
                    token, port.tag, field.mask, field.defvalue, ok and default_seq or '', name))
                if field.is_analog then
                    local seqs = {}
                    for _, seq_type in ipairs({'increment', 'decrement'}) do
                        local seq_ok, seq = pcall(function()
                            return input:seq_to_tokens(field:default_input_seq(seq_type))
                        end)
                        table.insert(seqs, seq_ok and seq or '')
                    end
                    table.insert(analog_lines, string.format('%s|%d|%s|%s', port.tag, field.mask, seqs[1], seqs[2]))
                end
            end
        end
    end
    -- Before game-fields.txt: Node reads both once game-fields.txt is there.
    write_file(GAME_ANALOG_PATH, table.concat(analog_lines, '\n') .. '\n')
    write_file(GAME_FIELDS_PATH, table.concat(lines, '\n') .. '\n')
end

local fields_ok, fields_err = pcall(dump_game_fields)
if not fields_ok then
    io.stderr:write('[capture-daemon] game-fields dump error: ' .. tostring(fields_err) .. '\n')
end

local last_seen_request = nil
local armed_nonce = nil
-- A button capture: the candidates already pressed when it was armed, by index. One only counts
-- once released and pressed again: a button still held, or one a device reports as pressed all
-- along (a virtual joystick such as vJoy on Windows, seen holding twenty buttons at rest), would
-- otherwise be taken at once, before anything is pressed.
local held = {}
-- An "|axis" capture: the axes' values when it was armed, and how far each mouse axis moved since.
local armed_axis = false
local axis_baseline = {}
local axis_travel = {}
-- A stick pushed past half its range, or a mouse/spinner moved ~150 pixels: not a slight touch.
-- MAME reads the mouse even while its window is in the background, and the hand that just clicked
-- the BO's button still moves it: nothing counts for the first AXIS_GRACE_TICKS callbacks
-- (~1.5 s at 60 Hz) after arming.
local ABSOLUTE_AXIS_THRESHOLD = 32768
local RELATIVE_AXIS_THRESHOLD = 512 * 150
local AXIS_GRACE_TICKS = 90
local axis_ticks = 0
local last_seen_apply = nil
local frame = 0

local function apply_field(tag, mask, seq_tokens, seq_type)
    local port = manager.machine.ioport.ports[tag]
    if not port then
        return 'unknown port ' .. tag
    end
    for _, field in pairs(port.fields) do
        if field.mask == mask then
            -- Reset: DEFAULT makes the field follow its type's binding (default.cfg's, i.e. the global
            -- configuration) again, and MAME then leaves it out of the game's cfg on exit.
            -- field:default_input_seq() would be saved as an override (checked against 0.289).
            -- NONE (every control removed) is how a cfg writes an empty sequence, which
            -- seq_from_tokens() only gets from an empty string.
            local tokens = seq_tokens == '' and 'DEFAULT' or (seq_tokens == 'NONE' and '' or seq_tokens)
            local seq = input:seq_from_tokens(tokens)
            field:set_input_seq(seq_type, seq)
            return 'ok'
        end
    end
    return 'unknown field ' .. tag .. '/' .. mask
end

local function handle_apply()
    local request = read_file(APPLY_PATH)
    if not request or request == last_seen_apply then
        return
    end
    last_seen_apply = request
    local nonce, tag, mask, seq_tokens, seq_type = request:match('^([^|]*)|([^|]*)|(%d+)|([^|\n]*)|?(%a*)')
    if not nonce then
        return
    end
    if seq_type ~= 'increment' and seq_type ~= 'decrement' then
        seq_type = 'standard'
    end
    local ok, result = pcall(apply_field, tag, tonumber(mask), seq_tokens, seq_type)
    write_file(APPLIED_PATH, nonce .. '|' .. (ok and result or tostring(result)))
end

-- Wrapped in pcall: a candidate's code can go bad mid-session (e.g. its controller gets
-- unplugged) - logged to stderr and skipped rather than left to crash the whole callback, which
-- would otherwise silently stop it from ever running again while MAME itself stays open.
emu.register_periodic(function()
    local ok, err = pcall(function()
        frame = frame + 1
        if frame >= POLL_FRAMES then
            frame = 0
            local request = read_file(REQUEST_PATH)
            if request and request ~= last_seen_request then
                last_seen_request = request
                local nonce, mode = request:match('^([^|]*)|?(%a*)')
                armed_nonce = nonce
                armed_axis = mode == 'axis'
                axis_ticks = 0
                held = {}
                if not armed_axis then
                    for index, candidate in ipairs(candidates) do
                        if input:code_pressed(candidate.code) then
                            held[index] = true
                        end
                    end
                end
            end
            handle_apply()
        end

        if armed_nonce and armed_axis and axis_ticks < AXIS_GRACE_TICKS then
            axis_ticks = axis_ticks + 1
            if axis_ticks == AXIS_GRACE_TICKS then
                for index, candidate in ipairs(axis_candidates) do
                    axis_baseline[index] = input:code_value(candidate.code)
                    axis_travel[index] = 0
                end
            end
        elseif armed_nonce and armed_axis then
            for index, candidate in ipairs(axis_candidates) do
                local value = input:code_value(candidate.code)
                local moved
                if candidate.relative then
                    axis_travel[index] = axis_travel[index] + math.abs(value)
                    moved = axis_travel[index] > RELATIVE_AXIS_THRESHOLD
                else
                    moved = math.abs(value - axis_baseline[index]) > ABSOLUTE_AXIS_THRESHOLD
                end
                if moved then
                    write_file(RESULT_PATH, armed_nonce .. '|' .. input:code_to_token(candidate.code))
                    armed_nonce = nil
                    break
                end
            end
        elseif armed_nonce then
            for index, candidate in ipairs(candidates) do
                if not input:code_pressed(candidate.code) then
                    held[index] = nil
                elseif not held[index] then
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

-- The report on the game (docs: maui-api D87): what could make it easier than the arcade made it,
-- for each score found during it (ScoreCapture.ts joins it to the score). Rewritten as
-- session-report.json every second, on each event and when the game stops, so that it always
-- covers the game up to now. Node adds what it knows itself (ROM verification, versions).
local REPORT_PATH = CAPTURE_DIR .. '/session-report.json'
local ARRAY = {}

local function encode(value)
    local kind = type(value)
    if kind == 'table' then
        local parts = {}
        if getmetatable(value) == ARRAY then
            for _, item in ipairs(value) do
                table.insert(parts, encode(item))
            end
            return '[' .. table.concat(parts, ',') .. ']'
        end
        local keys = {}
        for key in pairs(value) do
            table.insert(keys, key)
        end
        table.sort(keys)
        for _, key in ipairs(keys) do
            table.insert(parts, encode(tostring(key)) .. ':' .. encode(value[key]))
        end
        return '{' .. table.concat(parts, ',') .. '}'
    elseif kind == 'string' then
        return '"' .. value:gsub('[%c"\\]', function(c)
            return string.format('\\u%04x', c:byte())
        end) .. '"'
    elseif kind == 'number' then
        if math.type(value) == 'integer' then
            return tostring(value)
        end
        return string.format('%.2f', value)
    elseif kind == 'boolean' then
        return tostring(value)
    end
    return 'null'
end

local function array(items)
    return setmetatable(items, ARRAY)
end

local report_started = os.time()
local events = {state_loads = 0, state_saves = 0, pauses = 0, pause_s = 0, resets = 0}
local paused_at = nil
local speed = {samples = 0, percent_sum = 0, below_95_s = 0, unthrottled_s = 0, fast_forward_s = 0}
local last_second = os.time()

local function option(name)
    local ok, value = pcall(function() return manager.options.entries[name]:value() end)
    if ok then
        return value
    end
    return nil
end

local function running_plugins()
    local names = {}
    for name, plugin in pairs(manager.plugins) do
        if plugin.start then
            table.insert(names, name)
        end
    end
    table.sort(names)
    return array(names)
end

-- The DIP switches set otherwise than the game's default, by their labels.
local function changed_dips()
    local dips = {}
    for _, port in pairs(manager.machine.ioport.ports) do
        for name, field in pairs(port.fields) do
            if field.type_class == 'dipswitch' and field.user_value ~= field.defvalue then
                local settings = field.settings
                table.insert(dips, {
                    name = name,
                    value = settings[field.user_value] or tostring(field.user_value),
                    default = settings[field.defvalue] or tostring(field.defvalue),
                })
            end
        end
    end
    table.sort(dips, function(a, b) return a.name < b.name end)
    return array(dips)
end

local function write_report()
    local now = os.time()
    local emulated = 0
    pcall(function() emulated = manager.machine.time:as_double() end)
    local report = {
        version = 1,
        mame_version = emu.app_version(),
        duration_s = now - report_started,
        emulated_s = emulated,
        options = {
            cheat = option('cheat'), rewind = option('rewind'), autosave = option('autosave'),
            console = option('console'), throttle = option('throttle'), speed = option('speed'),
        },
        plugins = running_plugins(),
        dips = changed_dips(),
        events = {
            state_loads = events.state_loads, state_saves = events.state_saves, pauses = events.pauses,
            pause_s = events.pause_s + (paused_at and now - paused_at or 0), resets = events.resets,
        },
        speed = {
            average_percent = speed.samples > 0 and speed.percent_sum / speed.samples or 100.0,
            below_95_s = speed.below_95_s, unthrottled_s = speed.unthrottled_s, fast_forward_s = speed.fast_forward_s,
        },
    }
    write_file(REPORT_PATH, encode(report))
end

local function guarded(callback)
    return function(...)
        local ok, err = pcall(callback, ...)
        if not ok then
            io.stderr:write('[capture-daemon] report error: ' .. tostring(err) .. '\n')
        end
    end
end

-- A MAME without one of these (older than the 0.289 this was checked against) only loses that
-- part of the report: the rest of this script must keep working.
local function subscribe(name, callback)
    local add = emu[name]
    return add and add(guarded(callback)) or false
end

-- Kept in a global: a notifier subscription is dropped once nothing references it, and a local
-- of this chunk that no function uses is collected once the chunk has run.
maui_report_subscriptions = {
    subscribe('add_machine_post_load_notifier', function()
        events.state_loads = events.state_loads + 1
        write_report()
    end),
    subscribe('add_machine_pre_save_notifier', function()
        events.state_saves = events.state_saves + 1
        write_report()
    end),
    subscribe('add_machine_pause_notifier', function()
        if not paused_at then
            events.pauses = events.pauses + 1
            paused_at = os.time()
        end
    end),
    subscribe('add_machine_resume_notifier', function()
        if paused_at then
            events.pause_s = events.pause_s + (os.time() - paused_at)
            paused_at = nil
        end
    end),
    subscribe('add_machine_reset_notifier', function()
        events.resets = events.resets + 1
    end),
    subscribe('add_machine_stop_notifier', write_report),
}

-- One sample of the speed per second of real time, out of pauses: emulated speed in percent of
-- real time, and whether throttling was on. Fast forward runs as fast as the machine can, far
-- above 150 %; a second just after a pause or a loaded state may catch up a little above 100 %.
local FAST_FORWARD_PERCENT = 150
emu.register_periodic(guarded(function()
    local now = os.time()
    if now == last_second then
        return
    end
    last_second = now
    if not paused_at and not manager.machine.paused then
        local video = manager.machine.video
        local percent = video.speed_percent * 100
        speed.samples = speed.samples + 1
        speed.percent_sum = speed.percent_sum + percent
        if percent < 95 then
            speed.below_95_s = speed.below_95_s + 1
        elseif percent > FAST_FORWARD_PERCENT then
            speed.fast_forward_s = speed.fast_forward_s + 1
        end
        if not video.throttled then
            speed.unthrottled_s = speed.unthrottled_s + 1
        end
    end
    write_report()
end))
