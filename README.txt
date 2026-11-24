FocusQuest
==========
A to-do and Jira ticket board that rewards you for getting things done.
Runs on Windows 11 without admin rights.


INSTALL
-------
1. Right-click the downloaded zip file > Properties > tick "Unblock" (German: "Zulassen")
   at the bottom > OK. Many company PCs refuse scripts from a zip file that is still
   marked as downloaded (the error says the script "is not digitally signed").
2. Extract the whole zip file anywhere, for example in Downloads.
3. Double-click  Install-FocusQuest.cmd
   It copies FocusQuest to %LOCALAPPDATA%\FocusQuest, adds a "FocusQuest" entry to the
   Start menu and starts the app. No admin rights are needed.
4. From now on start FocusQuest from the Start menu.
   A small "FocusQuest helper" window opens minimized and your browser opens
   http://localhost:8765/
5. Keep the helper window open while you work. Closing it stops FocusQuest.
   You can delete the zip file and the extracted folder.

Without the installer: put the extracted folder somewhere you can write to, for example
Documents\FocusQuest, and double-click Start-FocusQuest.cmd.

To uninstall, delete the folder %LOCALAPPDATA%\FocusQuest (this deletes your data too)
and the FocusQuest entry in the Start menu (right-click > Open file location > delete).

Tip: bookmark http://localhost:8765/ or pin the tab. Reminders only fire while the tab is open.


UPDATE
------
FocusQuest looks for a newer version once a day. When there is one, the line
"Version ... is available" appears at the bottom left. Click it, read what is new and
click "Install update". FocusQuest downloads the version from GitHub, checks it, replaces
its program files, restarts by itself and reloads the page. Your data is not touched.
Settings > Updates has "Check for updates" and a switch for the daily check.

By hand: download the newer zip file, close the helper window and do the install steps
again (the new zip file has to be unblocked too). Your data is kept.

Going back: every update keeps the version before it in data\update\previous. Close the
helper window, copy the files from there into the FocusQuest folder and start it again.
A copy of your data from before each update is in data\backups (pre-update-...).


WITHOUT THE HELPER (no scripts, no Jira)
----------------------------------------
If your PC does not run the scripts even after unblocking, or you only need the to-dos,
double-click app.html. To-dos, reminders and rewards work. Jira is switched off, and your
data is kept in the browser instead of a file. Clearing the browsing data deletes it:
use Settings > "Save a backup file" now and then.


FILES
-----
Install-FocusQuest.cmd installs into your user profile and adds the Start menu entry
install.ps1            the installer script behind it
Start-FocusQuest.cmd   starts everything
server.ps1             the helper: serves the page, saves your data, relays calls to Jira,
                       looks for updates and installs them
app.html               the app itself
version.txt            the installed version
data\                  created on first start
  focusquest-data.json   your to-dos, tickets, XP and settings
  helper-config.json     Jira address and the encrypted token
  backups\               one copy per day, last 14 days, and one from before each update
  update\previous\       the program files from before the last update

To move to another PC, copy the folder. The Jira token has to be entered again there,
because it is encrypted for your Windows user on this PC.


CONNECT JIRA (Data Center)
--------------------------
1. In Jira: profile picture > Profile > Personal Access Tokens > Create token.
2. In FocusQuest: Settings > Jira connection. Enter the Jira address
   (for example https://jira.your-company.com) and paste the token. "Save and test".
3. Settings > Ticket forms: a form is one kind of ticket you create. Enter its project
   key and its ticket type ("Pick the type from Jira" lists the types of the project).
   "Add a form" creates another one, for another ticket type or another Jira project.
   "Copy this form" starts from the current one. You choose the form when you create a ticket.
4. Fields in this form: "Components" is already there as a required field.
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
To-do to ticket  open the to-do > "Create Jira ticket from this". Choose a template or a
                 ticket form, fill in the fields, create. "Save as template" keeps what you
                 filled in.
Statistics       the left side shows what you created, closed and commented today.
                 Rewards shows the totals.


IF SOMETHING DOES NOT WORK
--------------------------
"... is not digitally signed"    The zip file was not unblocked before extracting, see INSTALL
 ("ist nicht digital signiert")  step 1. To see the policy of your PC, run in PowerShell:
                                   Get-ExecutionPolicy -List
                                 "RemoteSigned" means: downloaded scripts are blocked until
                                 you unblock them. "AllSigned" means: the scripts cannot run
                                 until your IT department signs them. Use app.html without
                                 the helper in that case (see above).
Helper window closes at once     Open PowerShell in the FocusQuest folder and run:
                                   powershell -ExecutionPolicy Bypass -File .\server.ps1
                                 to read the error message.
Update check does not work       Your network may block github.com for programs. Download the
                                 zip file in the browser and update by hand (see UPDATE).
"Jira did not accept the token"  The token is wrong or expired. Create a new one.
"Jira redirected to a login      Your Jira does not accept token logins on the REST API
 page"                           (single sign-on only). Ask your Jira admin.
"Jira could not be reached"      Check the address. From home you may need the VPN.
                                 If your proxy gets in the way, set "useSystemProxy": false
                                 in data\helper-config.json and restart.
Service Request tickets          They are created as normal Jira issues of that type. If your
                                 service desk needs a "Customer Request Type", add that field
                                 under Settings > Ticket forms.
Port 8765 is taken               The helper moves to the next free port and opens that address.
