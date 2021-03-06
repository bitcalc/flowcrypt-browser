# FlowCrypt: Encrypt Gmail with PGP


## Users

Get [FlowCrypt](https://flowcrypt.com/) browser extension at: https://flowcrypt.com/download



## Developers

This project is written in TypeScript. Browsers only understand JavaScript, so the project needs to be transpiled. You need to build the project the first time you download it, and build it after each change you make to see the result in the browser. First, install tooling:

```bash
$ cd some/folder/flowcrypt-browser
$ npm install --only=dev
$ sudo npm install -g gulp
```

To build your project:
```bash
$ gulp
```

You will see something like:
```
[13:09:03] Using gulpfile ~/git/flowcrypt-browser/gulpfile.js
[13:09:03] Starting 'default'...
[13:09:03] Starting 'flush'...
[13:09:03] Finished 'flush' after 84 ms
[13:09:03] Starting 'transpileProjectTs'...
[13:09:03] Starting 'copySourceFiles'...
[13:09:03] Starting 'copyVersionedManifest'...
[13:09:04] Finished 'copyVersionedManifest' after 404 ms
[13:09:10] Finished 'transpileProjectTs' after 6.83 s
[13:09:10] Finished 'copySourceFiles' after 6.89 s
[13:09:10] Starting 'copyChromeToFirefox'...
[13:09:11] Finished 'copyChromeToFirefox' after 254 ms
[13:09:11] Starting 'copyChromeToFirefoxEditedManifest'...
[13:09:11] Finished 'copyChromeToFirefoxEditedManifest' after 13 ms
[13:09:11] Finished 'default' after 7.24 s
```

Now you can find your built project in `build/chrome` and `build/firefox`
