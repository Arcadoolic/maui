-- Bundled with mame-awesome-ui (see boServer.ts's runInputDefaultsProbe()), loaded via
-- -autoboot_script on a MAME started with an empty -cfg_directory, so what it reads is MAME's own
-- binding for every input type, before default.cfg changes any - MAME's Lua has no accessor for an
-- input type's default sequence once a cfg overrode it (checked against 0.289). Also lists the
-- keyboard keys and mouse buttons MAME knows, so the BO only ever offers tokens MAME itself
-- printed (a single bad token in default.cfg makes MAME drop its whole <input> block). Printed to
-- stdout, parsed by MameInputSeq.ts's parseInputDefaults():
--     MAUI_SEQ|<PORT_TYPE>|<standard sequence>
--     MAUI_CODE|<token>|<item name>
-- then exits the machine.

local input = manager.machine.input
local ioport = manager.machine.ioport

for _, port_type in pairs(ioport.types) do
    local token = tostring(port_type.token)
    local ok, seq = pcall(function()
        return input:seq_to_tokens(ioport:type_seq(port_type.type, port_type.player or 0, 'standard'))
    end)
    if ok and seq and not port_type.is_analog then
        print(string.format('MAUI_SEQ|%s|%s', token, seq))
    end
end

local function print_codes(class_name, only_buttons)
    local class = input.device_classes[class_name]
    if not class then
        return
    end
    for _, device in pairs(class.devices) do
        for _, item in pairs(device.items) do
            if not only_buttons or item.token:find('^BUTTON%d+$') then
                print(string.format('MAUI_CODE|%s|%s', input:code_to_token(item.code), item.name))
            end
        end
    end
end

print_codes('keyboard', false)
print_codes('mouse', true)

manager.machine:exit()
