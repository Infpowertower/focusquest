FocusQuest
==========
A to-do and Jira ticket board that rewards you for getting things done.
Runs on Windows 11 without installation and without admin rights.


INSTALL
-------
1. Extract the whole zip file anywhere, for example in Downloads.
2. Double-click  Install-FocusQuest.cmd
   It copies FocusQuest to %LOCALAPPDATA%\FocusQuest, adds a "FocusQuest" entry to the
   Start menu and starts the app. No admin rights are needed.
3. From now on start FocusQuest from the Start menu.
   A small "FocusQuest helper" window opens minimized and your browser opens
   http://localhost:8765/
4. Keep the helper window open while you work. Closing it stops FocusQuest.

To update, download the newer zip and run Install-FocusQuest.cmd again. Your data is kept.
To uninstall, delete the folder %LOCALAPPDATA%\FocusQuest (this deletes your data too)
and the FocusQuest entry in the Start menu (right-click > Open file location > delete).

Without the installer: put the extracted folder somewhere you can write to, for example
Documents\FocusQuest, and double-click Start-FocusQuest.cmd.

BROWSER VERSION (no scripts, no Jira)
------------------------------------
If your PC does not run the scripts (see "is not digitally signed" below), or you only
need the to-dos, use FocusQuest in the browser:

  https://infpowertower.github.io/focusquest/

In Edge choose  ... > Apps > Install this site as an app  (Chrome: ... > Cast, save and
share > Install page as app). FocusQuest then has its own window and a Start menu entry,
works offline and updates itself. Alternatively double-click app.html in this folder.

In the browser version Jira is switched off, and your data is kept in the browser instead
of a file. Clearing the browsing data deletes it: use Settings > "Save a backup file"
now and then.


If Windows shows a security warning for the downloaded files: right-click the zip file
before extracting, choose Properties, tick "Unblock", then extract again.

Tip: bookmark http://localhost:8765/ or pin the tab. Reminders only fire while the tab is open.


FILES
-----
Install-FocusQuest.cmd installs into your user profile and adds the Start menu entry
install.ps1            the installer script behind it
Start-FocusQuest.cmd   starts everything
server.ps1             the helper: serves the page, saves your data, relays calls to Jira
app.html               the app itself
data\                  created on first start
  focusquest-data.json   your to-dos, tickets, XP and settings
  helper-config.json     Jira address and the encrypted token
  backups\               one copy per day, last 14 days

To move to another PC, copy the folder. The Jira token has to be entered again there,
because it is encrypted for your Windows user on this PC.


CONNECT JIRA (Data Center)
--------------------------
1. In Jira: profile picture > Profile > Personal Access Tokens > Create token.
2. In FocusQuest: Settings > Jira connection. Enter the Jira address
   (for example https://jira.your-company.com) and paste the token. "Save and test".
3. Settings > New tickets: enter your project key and the ticket types you use.
4. Settings > Fields in the ticket form: "Components" is already there as a required field.
   Click "Pick the choices from Jira" and tick the components your team uses.
   "Find fields in Jira" lists every other field of the create screen so you can add it.


EVERYDAY USE
------------
Add a to-do      type in the box at the top, press Enter.  Key N or / jumps to the box.
                 !1 !2 !3 set the priority, @today @tomorrow @fri @24.12. @14:30 set the due date.
Prioritize       click the High / Medium / Low label on a row, or the star to make it your focus.
Up next          the big card shows one thing. "Not now" shows another one.
Due + reminder   open an item. Without a separate reminder you are reminded on the due day
                 (at the due time, or at 09:00 if there is none; change the time in Settings).
Import tickets   "Import tickets": type keys, or tick tickets from "Assigned to me".
Ticket details   assignee, author, description and comments. Comment, change the status,
                 close, or assign to yourself. "Refresh now" reloads one ticket,
                 "Refresh tickets" all of them. Automatic refresh: Settings (default 15 minutes).
To-do to ticket  open the to-do > "Create Jira ticket from this". Choose a template or your
                 defaults, pick the type and components, create. "Save as template" keeps the form.


IF SOMETHING DOES NOT WORK
--------------------------
"... is not digitally signed"  Your company only allows signed PowerShell scripts.
 ("ist nicht digital signiert")  Run this in PowerShell to see the policy:
                                   Get-ExecutionPolicy -List
                                 MachinePolicy or UserPolicy "RemoteSigned": only downloaded
                                 scripts are blocked. Right-click the zip file > Properties >
                                 tick "Unblock" (Zulassen) > extract again.
                                 "AllSigned": the scripts cannot run until your IT department
                                 signs or approves them. Use the browser version (see above).
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
