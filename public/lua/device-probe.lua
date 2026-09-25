-- Bundled with mame-awesome-ui (see boServer.ts's runDeviceProbe()), loaded via -autoboot_script
-- to dump every joystick/gamepad device MAME currently detects, one line per device, then exit
-- the machine. Printed to stdout in a stable marker-prefixed format so boServer.ts's
-- parseDeviceProbeOutput() can find it amid MAME's normal boot chatter:
--     MAUI_DEVICE_ROW|<device name>|<device id>|<item name>=<item token>,...|<JOYCODE_n>
-- e.g. MAUI_DEVICE_ROW|Xbox 360 Controller|030081b8...|A=BUTTON1,B=BUTTON2,LT=SLIDER1|JOYCODE_1
-- <JOYCODE_n> is the number MAME gives the device in its input codes (what "JOY 1"/"JOY 2" means
-- in its menus), taken from the full code of any of its items (e.g. "JOYCODE_1_BUTTON1") - empty
-- for a device without items.

local joystick_class = manager.machine.input.device_classes.joystick

if joystick_class then
    for _, device in pairs(joystick_class.devices) do
        local items = {}
        local joycode = ''
        for _, item in pairs(device.items) do
            table.insert(items, item.name .. '=' .. item.token)
            if joycode == '' then
                joycode = string.match(manager.machine.input:code_to_token(item.code), '^(JOYCODE_%d+)_') or ''
            end
        end
        print(string.format('MAUI_DEVICE_ROW|%s|%s|%s|%s', device.name, device.id, table.concat(items, ','), joycode))
    end
end

manager.machine:exit()
