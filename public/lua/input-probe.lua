-- Bundled with mame-awesome-ui (see boServer.ts's runInputProbe()), loaded via -autoboot_script
-- to dump each P1/P2 controller field's default and current effective input sequence, then exit
-- the machine. One line per wanted field, printed to stdout in a stable marker-prefixed format so
-- boServer.ts's parseInputProbeOutput() can find it amid MAME's normal boot chatter:
--     MAUI_INPUT_ROW|<field display name>|<default seq text>|<current seq text>
-- e.g. MAUI_INPUT_ROW|P1 Up|KEYCODE_UP|KEYCODE_UP or Joy1 Up
--
-- Deliberately only P1/P2 Up/Down/Left/Right/Start/Coin/Button<n> controller fields - anything
-- else (service/UI/keyboard/dipswitch/config fields, or any other player) never matches
-- is_wanted_field() below and is skipped.

local EXACT_FIELD_NAMES = {
    ["P1 Up"] = true, ["P1 Down"] = true, ["P1 Left"] = true, ["P1 Right"] = true,
    ["P1 Start"] = true, ["P1 Coin"] = true,
    ["P2 Up"] = true, ["P2 Down"] = true, ["P2 Left"] = true, ["P2 Right"] = true,
    ["P2 Start"] = true, ["P2 Coin"] = true,
}

local function is_wanted_field(name)
    if EXACT_FIELD_NAMES[name] then
        return true
    end
    -- Exact string equality for the fixed names above (confirmed against this MAME build's own
    -- literal field-name strings); string.match only for the open-ended "Button <n>" family,
    -- where n varies per game.
    return string.match(name, "^P[12] Button %d+$") ~= nil
end

local input = manager.machine.input

for _, port in pairs(manager.machine.ioport.ports) do
    for name, field in pairs(port.fields) do
        if field.type_class == "controller" and is_wanted_field(name) then
            local default_text = input:seq_name(field:default_input_seq("standard"))
            local current_text = input:seq_name(field:input_seq("standard"))
            print(string.format("MAUI_INPUT_ROW|%s|%s|%s", name, default_text, current_text))
        end
    end
end

manager.machine:exit()
