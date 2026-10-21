import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const base=new URL('.',import.meta.url);
if(process.platform==='darwin') {
  const contents=new URL('dist/FolderPicker.app/Contents/',base);
  mkdirSync(new URL('MacOS/',contents),{recursive:true});
  writeFileSync(new URL('Info.plist',contents),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>folder-picker</string><key>CFBundleIdentifier</key><string>org.gpt-commenter.folder-picker</string><key>CFBundleName</key><string>MarkAtlas</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><false/></dict></plist>`);
  execFileSync('/usr/bin/xcrun',['swiftc',new URL('native/FolderPicker.swift',base).pathname,'-o',new URL('MacOS/folder-picker',contents).pathname,'-module-cache-path',join(tmpdir(),'gpt-commenter-swift-cache')],{stdio:'inherit'});
}
