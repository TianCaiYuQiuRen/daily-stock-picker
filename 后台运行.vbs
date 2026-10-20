' 每日选股 - 后台静默启动（不弹黑框、不打开浏览器）
Option Explicit
Dim fso, ws, base, pyw, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
ws.CurrentDirectory = base

pyw = base & "\python\pythonw.exe"
If Not fso.FileExists(pyw) Then
    pyw = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python312\pythonw.exe"
End If
If fso.FileExists(pyw) Then
    cmd = """" & pyw & """ """ & base & "\server.py"""
Else
    cmd = "pythonw.exe """ & base & "\server.py"""
End If
ws.Run cmd, 0, False
