-- Bundled with mame-awesome-ui (see boServer.ts's runDeviceProbe()), loaded via -autoboot_script
-- to dump every joystick/gamepad device MAME currently detects, one line per device, then exit
-- the machine. Printed to stdout in a stable marker-prefixed format so boServer.ts's
-- parseDeviceProbeOutput() can find it amid MAME's normal boot chatter:
--     MAUI_DEVICE_ROW|<device name>|<device id>|<item name>=<item token>,<item name>=<item token>,...
-- e.g. MAUI_DEVICE_ROW|Xbox 360 Controller|030081b8...|A=BUTTON1,B=BUTTON2,LB=BUTTON5,LT=SLIDER1

local joystick_class = manager.machine.input.device_classes.joystick

if joystick_class then
    for _, device in pairs(joystick_class.devices) do
        local items = {}
        for _, item in pairs(device.items) do
            table.insert(items, item.name .. '=' .. item.token)
        end
        print(string.format('MAUI_DEVICE_ROW|%s|%s|%s', device.name, device.id, table.concat(items, ',')))
    end
end

manager.machine:exit()
