# FocusQuest

A to-do and Jira ticket board that rewards you for getting things done (XP, levels, streaks, badges). Built for Windows 11 PCs where you cannot install software: it needs no admin rights and uses only what ships with Windows (Windows PowerShell 5.1 and a browser).

## Install

1. Download `FocusQuest-<version>.zip` from the [latest release](https://github.com/Infpowertower/focusquest/releases/latest).
2. Right-click the zip file, choose **Properties**, tick **Unblock** and click OK. Company PCs often refuse scripts from a zip file that is still marked as downloaded ("is not digitally signed").
3. Extract the zip.
4. Double-click `Install-FocusQuest.cmd`. It copies the app to `%LOCALAPPDATA%\FocusQuest`, adds a **FocusQuest** entry to the Start menu and starts the app.

To update, download the newer zip and do the same again. Your data is kept. `README.txt` inside the zip explains everyday use and the Jira connection.

## Browser version

If your PC only runs signed PowerShell scripts (execution policy `AllSigned`), or you only need the to-dos, open <https://infpowertower.github.io/focusquest/> and install it from the browser menu (Edge: **Apps > Install this site as an app**). That gives a Start menu entry, works offline and updates itself, with no scripts involved. Jira is switched off in this version, because a web page cannot call Jira Data Center without the helper, and the data is kept in the browser rather than in a file.

## How it works

`Start-FocusQuest.cmd` starts `server.ps1`, a small helper that listens on `http://localhost:8765/` only. It serves the app (a single self-contained `app.html`), keeps your data in a `data` folder next to it, and relays REST calls to your Jira Data Center with a personal access token that never reaches the browser.

## Build

```bash
node dev/build.js --web     # writes app.html and site/
node dev/run-tests.js       # browser tests against a mock Jira, needs playwright
```

The build inlines `src/` into `app.html` and writes the browser version to `site/`. Every push to `main` builds the zip, tests the installer on Windows, publishes the browser version to GitHub Pages, and publishes a release named `<VERSION>.<run number>`; raise the number in `VERSION` for a new major or minor version.

## License

[MIT](LICENSE). FocusQuest is not affiliated with or endorsed by Atlassian. Jira is a trademark of Atlassian.
