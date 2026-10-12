param([string]$Chrome = $env:CHROME_PATH)
if (-not $Chrome) { $Chrome = (Get-Command chrome -ErrorAction SilentlyContinue).Source }
if (-not $Chrome) { throw "Set CHROME_PATH or pass -Chrome with the path to chrome.exe." }
$dir = $PSScriptRoot
$base = "file:///" + ($dir -replace '\\', '/') + "/proto.html"
foreach ($n in 300, 600, 1500, 3000) {
  $url = "$base`?n=$n&bench=200"
  Start-Process -FilePath $Chrome -ArgumentList @("--headless=new", "--user-data-dir=`"$dir\chrome-prof`"", "--virtual-time-budget=10000", "--dump-dom", "`"$url`"") -RedirectStandardOutput "$dir\dom.txt" -Wait | Out-Null
  (Select-String -Path "$dir\dom.txt" -Pattern '<pre id="stats">([^<]*)').Matches.Groups[1].Value
}
foreach ($w in 'char', 'word') {
  Start-Process -FilePath $Chrome -ArgumentList @("--headless=new", "--user-data-dir=`"$dir\chrome-prof`"", "--window-size=920,700", "--virtual-time-budget=4000", "--screenshot=`"$dir\proto-demo-$w.png`"", "`"$base`?n=600&demo=1&wrap=$w`"") -Wait | Out-Null
}
