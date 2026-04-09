# Stronghold Demo GIF
# Run: vhs stronghold-demo.tape

Output docs/assets/demo.gif

Require stronghold

Set Shell "powershell"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"
Set WindowBar "Colorful"
Set WindowBarSize 40
Set BorderRadius 8
Set Margin 20
Set MarginFill "#1e1e2e"
Set Framerate 30
Set PlaybackSpeed 1.5
Set LoopOffset 60%

# --- Scene 1: Demo scan ---

Type "stronghold demo"
Sleep 500ms
Enter
Sleep 6s

# --- Scene 2: Status ---

Type "stronghold status"
Sleep 500ms
Enter
Sleep 8s

# --- Scene 3: Scenarios (just the top) ---

Type "stronghold scenarios"
Sleep 500ms
Enter
Sleep 6s

# Final pause
Sleep 2s
