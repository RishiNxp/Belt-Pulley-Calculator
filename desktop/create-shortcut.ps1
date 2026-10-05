$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$shell = New-Object -ComObject WScript.Shell
$desktop = $shell.SpecialFolders.Item('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop)) {
  throw 'Windows could not locate your desktop folder.'
}
[System.IO.Directory]::CreateDirectory($desktop) | Out-Null
$arguments = '"' + $env:BELT_CALCULATOR_PROJECT + '"'
$suffix = 0
while ($true) {
  $name = if ($suffix -eq 0) { 'Belt Pulley Calculator.lnk' } else { "Belt Pulley Calculator ($suffix).lnk" }
  $shortcutPath = Join-Path $desktop $name
  $shortcut = $shell.CreateShortcut($shortcutPath)
  if (!(Test-Path -LiteralPath $shortcutPath) -or (
    $shortcut.TargetPath -eq $env:BELT_CALCULATOR_EXECUTABLE -and $shortcut.Arguments -eq $arguments
  )) { break }
  $suffix++
}
$shortcut.TargetPath = $env:BELT_CALCULATOR_EXECUTABLE
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $env:BELT_CALCULATOR_PROJECT
$shortcut.Description = 'Open Belt Pulley Calculator'
$shortcut.IconLocation = $env:BELT_CALCULATOR_EXECUTABLE + ',0'
$shortcut.WindowStyle = 1
$shortcut.Save()
if (!(Test-Path -LiteralPath $shortcutPath)) {
  throw 'Windows did not save the desktop shortcut.'
}
$savedShortcut = $shell.CreateShortcut($shortcutPath)
if ($savedShortcut.TargetPath -ne $env:BELT_CALCULATOR_EXECUTABLE -or $savedShortcut.Arguments -ne $arguments) {
  throw 'The desktop shortcut was not saved with the expected application path.'
}
Write-Output $shortcutPath
