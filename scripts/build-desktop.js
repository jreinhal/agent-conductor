const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

async function build() {
    console.log('🏗️  Starting Next.js Build...');
    execSync('npm run build', { stdio: 'inherit' });

    console.log('📂 Copying Static Assets to Standalone...');
    const standaloneDir = path.join(__dirname, '../.next/standalone');
    const staticSource = path.join(__dirname, '../.next/static');
    const staticDest = path.join(standaloneDir, '.next/static');
    const publicSource = path.join(__dirname, '../public');
    const publicDest = path.join(standaloneDir, 'public');

    // Ensure fs-extra is installed or use fs
    // Since we didn't install fs-extra, let's use standard fs with recursive copy if node > 16.7
    // Or just use shell commands via execSync for Windows

    // Using Robocopy for Windows reliability or cp for others
    const isWin = process.platform === 'win32';

    try {
        if (isWin) {
            // Windows copy
            // /E = recursive, /I = assume dest is dir, /Y = suppress confirm
            // We use xcopy or robocopy. Node's fs.cpSync is available in Node 16.7+
            if (fs.cpSync) {
                fs.cpSync(staticSource, staticDest, { recursive: true });
                fs.cpSync(publicSource, publicDest, { recursive: true });
            } else {
                console.log('Node version too old for cpSync, using shell copy...');
                execSync(`xcopy "${staticSource}" "${staticDest}" /E /I /Y`);
                execSync(`xcopy "${publicSource}" "${publicDest}" /E /I /Y`);
            }
        } else {
            execSync(`cp -r "${staticSource}" "${staticDest}"`);
            execSync(`cp -r "${publicSource}" "${publicDest}"`);
        }
        console.log('✅ Assets Copied.');
    } catch (e) {
        console.error('Error copying assets:', e);
        // Continue anyway, it might fail if dirs exist
    }

    console.log('📦 Packaging with Electron-Builder...');
    execSync('npx electron-builder', { stdio: 'inherit' });
}

build();
