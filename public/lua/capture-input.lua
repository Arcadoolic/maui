-- Bundled with mame-awesome-ui (see boServer.ts's runCaptureInput()), loaded via -autoboot_script.
-- Waits for the player to press any joystick button/axis and prints the exact token MAME itself
-- would accept in a default.cfg <newseq> for it, then exits:
--     MAUI_CAPTURED|<token>              e.g. MAUI_CAPTURED|JOYCODE_1_BUTTON5
--     MAUI_CAPTURE_TIMEOUT               (nothing pressed before CAPTURE_TIMEOUT_FRAMES)
--
-- Every joystick item is turned into one or more "switch-class" candidate codes up front - a
-- token already naming a button/hat/start/select is used as-is; a token from the fixed
-- ANALOG_AXIS_TOKENS set (a stick/slider/trigger reported as an absolute axis, e.g. 8BitDo's LT as
-- "SLIDER1") gets both its _POS_SWITCH and _NEG_SWITCH derived forms tried, since MAME doesn't
-- expose a plain "is this axis held past its threshold" check independent of direction. Only
-- code_from_token/code_pressed/code_to_token are used - confirmed present on this MAME build
-- (0.289); the seemingly-obvious seq_poll_start/seq_poll pair used by MAME's own internal "press a
-- key" prompt is NOT exposed to Lua, hence this poll-every-frame approach instead.

local CAPTURE_TIMEOUT_FRAMES = 1800 -- ~30s at 60fps, generous for a human to react

local ANALOG_AXIS_TOKENS = {
    XAXIS = true, YAXIS = true, ZAXIS = true,
    RXAXIS = true, RYAXIS = true, RZAXIS = true,
    SLIDER1 = true, SLIDER2 = true, DIAL = true,
}

local input = manager.machine.input
local joystick_class = input.device_classes.joystick
local candidates = {} -- list of {token = string, code = input_code}

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

local elapsed = 0
emu.register_periodic(function()
    elapsed = elapsed + 1
    for _, candidate in ipairs(candidates) do
        if input:code_pressed(candidate.code) then
            print('MAUI_CAPTURED|' .. input:code_to_token(candidate.code))
            manager.machine:exit()
            return
        end
    end
    if elapsed > CAPTURE_TIMEOUT_FRAMES then
        print('MAUI_CAPTURE_TIMEOUT')
        manager.machine:exit()
    end
end)
