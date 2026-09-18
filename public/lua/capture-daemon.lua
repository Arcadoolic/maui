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
