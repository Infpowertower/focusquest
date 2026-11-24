FocusQuest
==========
A to-do and Jira ticket board that rewards you for getting things done.
Runs on Windows 11 without installation and without admin rights.


INSTALL
-------
1. Right-click the downloaded zip file > Properties > tick "Unblock" (German: "Zulassen")
   at the bottom > OK. Many company PCs refuse scripts from a zip file that is still
   marked as downloaded ("... is not digitally signed"  The zip file was not unblocked before extracting, see INSTALL
 ("ist nicht digital signiert")  step 1. To see the policy of your PC, run in PowerShell:
                                   Get-ExecutionPolicy -List
                                 "RemoteSigned" means: downloaded scripts are blocked until
                                 you unblock them. "AllSigned" means: the scripts cannot run
                                 until your IT department signs them. Use the browser
                                 version (see above) in that case.
Helper window closes at once     Your company may block PowerShell scripts. Open PowerShell
                                 in this folder and run:
                                   powershell -ExecutionPolicy Bypass -File .\server.ps1
                                 to read the error message.
"Jira did not accept the token"  The token is wrong or expired. Create a new one.
"Jira redirected to a login      Your Jira does not accept token logins on the REST API
 page"                           (single sign-on only). Ask your Jira admin.
"Jira could not be reached"      Check the address. From home you may need the VPN.
                                 If your proxy gets in the way, set "useSystemProxy": false
                                 in data\helper-config.json and restart.
Service Request tickets          They are created as normal Jira issues of that type. If your
                                 service desk needs a "Customer Request Type", add that field
                                 under Settings > Fields in the ticket form.
Port 8765 is taken               The helper moves to the next free port and opens that address.
You opened app.html directly     To-dos work and are kept in the browser, Jira is switched off.
                                 Use Start-FocusQuest.cmd.
