# Fish completion for hyper-dash

# Main commands
complete -c hyper-dash -f -n "__fish_use_subcommand" -a "dash" -d "Start the dashboard TUI"
complete -c hyper-dash -f -n "__fish_use_subcommand" -a "help" -d "Show help information"
complete -c hyper-dash -f -n "__fish_use_subcommand" -a "version" -d "Show version information"
complete -c hyper-dash -f -n "__fish_use_subcommand" -a "test" -d "Run in test mode"

# Options for dash command
complete -c hyper-dash -n "__fish_seen_subcommand_from dash" -s m -l mode -d "Set dashboard mode" -xa "basic advanced performance debug"
complete -c hyper-dash -n "__fish_seen_subcommand_from dash" -s e -l epic -d "Select epic" -xa "(__hyper_dash_complete_epics)"
complete -c hyper-dash -n "__fish_seen_subcommand_from dash" -s v -l verbose -d "Enable verbose output"
complete -c hyper-dash -n "__fish_seen_subcommand_from dash" -s d -l debug -d "Enable debug mode"
complete -c hyper-dash -n "__fish_seen_subcommand_from dash" -s c -l config -d "Config file path" -ra "(__fish_complete_suffix .json)"
complete -c hyper-dash -n "__fish_seen_subcommand_from dash" -s h -l help -d "Show help"

# Function to complete epic names
function __hyper_dash_complete_epics
    if test -d .taskmaster
        find .taskmaster -name "*.json" -exec basename {} .json \; 2>/dev/null
    end
end