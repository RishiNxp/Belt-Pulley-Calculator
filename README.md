# Pitch

Pitch is a desktop sized drivetrain editor for robotics builders. Lay out gears, pulleys, belts, and shared axles, dimension shaft centers, and compare drive ratios.

## Download the desktop app

### Windows 10 or 11

1. [Download Pitch for Windows](https://github.com/RishiNxp/pitch-desktop/releases/latest/download/Pitch-Windows-x64.zip).
2. In File Explorer, right click the ZIP and choose **Extract All**.
3. Open the extracted **Pitch** folder and run **Pitch.exe**.

Keep the extracted folder together. Pitch includes its runtime and works offline. Windows may identify the portable app as an unsigned download.

### macOS

Open the [Pitch for macOS releases](https://github.com/RishiNxp/pitch-mac/releases) and choose **arm64** for Apple Silicon or **x64** for Intel. Extract the ZIP and move **Pitch.app** to Applications.

The latest public Mac build is v1.0.0. It is ad hoc signed and not notarized, so it does not pass Apple's normal Gatekeeper checks. A signed, notarized release will be posted on the same releases page after the required Apple developer credentials are configured.

## Push changes to GitHub

Install Git, then clone this source repository:

~~~sh
git clone https://github.com/RishiNxp/Belt-Pulley-Calculator.git
cd Belt-Pulley-Calculator
git switch -c docs/my-change
~~~

After editing, review and push your work:

~~~sh
git status
git add README.md
git commit -m "Update project documentation"
git push -u origin docs/my-change
~~~

Replace **README.md** with the paths you changed, or use **git add -A** to stage all changes. Open a pull request on GitHub to propose your branch. Direct pushes to the official repositories require write access. If you do not have it, fork the repository first and push your branch to your fork.

## Publish an updated desktop app

The app source and release packages use separate repositories. Pushing to this source repository does not update the downloadable app.

For Windows releases, clone [pitch-desktop](https://github.com/RishiNxp/pitch-desktop). On Windows, run **npm ci**, **npm test**, then **.\Build-Windows.ps1**. Commit and push the changes, then push a new version tag such as **v1.1.2**. The tag starts the GitHub Actions build and publishes the ZIP to the [Windows releases page](https://github.com/RishiNxp/pitch-desktop/releases).

For the website, push a commit to **main** in [pitch-web](https://github.com/RishiNxp/pitch-web). GitHub Pages builds and publishes it automatically.

For macOS releases, use [pitch-mac](https://github.com/RishiNxp/pitch-mac) and push a version tag after configuring its signing and Apple notarization secrets. The release workflow checks the signature, notarization ticket, and Gatekeeper assessment before publishing.

## Run the calculator from source

Use Node.js 22.12 or newer and npm:

~~~sh
npm ci
npm run dev
~~~

Run **npm test** for the logic suite. Run **npm run build** to type check and create the production site in **dist**.

## Use Pitch

- Place pulleys, gears, or tensioners from the toolbar.
- Drag compatible gears together until both pitch circles turn green to mesh them.
- Right click an axle to add a part or change the stack order.
- Choose **Create belt**, select pulleys, then press Enter to finish the belt.
- Drag a tensioner or compatible free pulley onto a belt. Right click it to edit or remove it.
- Use the dimension tools to constrain center distances. Choose a train, driver, and driven output in the drive panel.
- Refresh restores the saved layout in the same browser. Use **Save file** to export a portable layout.

Pitch models planar layouts and ideal speed ratios. It does not model load capacity, backlash, or material strength.
