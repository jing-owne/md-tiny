' md-tiny - file association entry point
' Invoked hidden via:  wscript.exe //B "open-md.vbs" "%1"
' Job: read the node path, then run launcher.js in the background.
'
' NOTE: keep this file ASCII-only. Windows Script Host reads .vbs using the
'       system ANSI code page, so any non-ASCII byte would be mis-decoded.
Option Explicit

Dim fso, sh, baseDir, nodePath, fileArg, cmd, ts

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Log every invocation. A new line here means the file association
' really did reach the script host.
WriteLog fso, baseDir, "invoked, args=" & WScript.Arguments.Count

' node path: prefer node-path.txt, fall back to "node" from PATH
nodePath = "node"
If fso.FileExists(baseDir & "\node-path.txt") Then
  On Error Resume Next
  Set ts = fso.OpenTextFile(baseDir & "\node-path.txt", 1)
  If Err.Number = 0 Then
    If Not ts.AtEndOfStream Then nodePath = Trim(ts.ReadAll())
    ts.Close
  End If
  Err.Clear
  On Error GoTo 0
End If
If Len(nodePath) = 0 Then nodePath = "node"

fileArg = ""
If WScript.Arguments.Count > 0 Then fileArg = " """ & WScript.Arguments(0) & """"

If Not fso.FileExists(baseDir & "\launcher.js") Then
  WriteLog fso, baseDir, "launcher.js not found in " & baseDir
  WScript.Quit 1
End If

sh.CurrentDirectory = baseDir
cmd = """" & nodePath & """ """ & baseDir & "\launcher.js""" & fileArg

On Error Resume Next
sh.Run cmd, 0, False
If Err.Number <> 0 Then
  WriteLog fso, baseDir, "Run failed (" & Err.Number & "): " & Err.Description & " | cmd=" & cmd
  ' last resort: try plain "node" from PATH
  sh.Run """node"" """ & baseDir & "\launcher.js""" & fileArg, 0, False
  If Err.Number <> 0 Then
    WriteLog fso, baseDir, "Fallback also failed (" & Err.Number & "): " & Err.Description
  End If
End If
On Error GoTo 0

Sub WriteLog(fsoObj, folderPath, msg)
  Dim lf
  On Error Resume Next
  Set lf = fsoObj.OpenTextFile(folderPath & "\vbs.log", 8, True)
  lf.WriteLine Now & "  " & msg
  lf.Close
  On Error GoTo 0
End Sub
