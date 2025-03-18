import { app, globalShortcut, BrowserWindow, session, powerSaveBlocker } from "electron"
import path from "path"
import { rpcLogin } from "./rpc"

const userAgentWindows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36 Edg/105.0.1343.53"

let rpcDisabled = false

app.commandLine.appendSwitch("enable-features", "VaapiVideoDecoder")
app.commandLine.appendSwitch("enable-accelerated-mjpeg-decode")
app.commandLine.appendSwitch("enable-accelerated-video")
app.commandLine.appendSwitch("ignore-gpu-blacklist")
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers")
app.commandLine.appendSwitch("enable-gpu-rasterization")



app.whenReady().then(() => {
    const mainWindow = new BrowserWindow({
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: false,
        },
        width: 1280,
        height: 800,
        title: "Xbox Cloud Gaming",
    })

    if (process.argv.includes("--no-rpc")) rpcDisabled = true

    if (process.argv.includes("--gpu-info")) {
        mainWindow.loadURL("chrome://gpu")
        rpcDisabled = true
    } else if (process.argv.includes("--open")) {
        const index = process.argv.indexOf("--open")

        if (process.argv[index + 1] && !process.argv[index + 1].startsWith("-")) {
            mainWindow.loadURL(process.argv[index + 1])
            rpcDisabled = true
        }
    } else {
        mainWindow.setBackgroundColor("#1A1D1F")
        mainWindow.loadURL("https://www.xbox.com/play")
        mainWindow.maximize()
    }


    mainWindow.focus()
    
    if (!process.argv.includes("--normal-user-agent")) {
        const filter = {
            urls: ["https://xbox.com/*"]
        }
          
        session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
            details.requestHeaders["User-Agent"] = userAgentWindows
            callback({ requestHeaders: details.requestHeaders })
        })
    }

    globalShortcut.register("F11", () => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setFullScreen(!win.isFullScreen())
    })
})

app.on("browser-window-created", async (_, window) => {
    window.setMenu(null)
    
    if (!process.argv.includes("--normal-user-agent")) {
        window.webContents.setUserAgent(userAgentWindows)
    }

    const injectCode = () => {
        if (!process.argv.includes("--gpu-info"))
            window.webContents.insertCSS(/*css*/`
                ::-webkit-scrollbar { display: none; }
            `)

        
        if (!process.argv.includes("--dont-hide-pointer")) {
            window.webContents.insertCSS(/*css*/`
                .no-pointer { cursor: none; }
            `)

            window.webContents.executeJavaScript(/*javascript*/`
                document.addEventListener("mousemove", () => {
                    document.querySelectorAll("*").forEach((element) => {
                        element.classList.remove("no-pointer")
                    })
                })

                setInterval(() => {
                    for (const gamepad of navigator.getGamepads()) {
                        if (!gamepad) continue

                        const pressed = [...gamepad.buttons.map(b => b.value), ...gamepad.axes].filter(v => v >= 0.8 || v <= -0.8)

                        if (pressed.length > 0) {
                            document.querySelectorAll("*").forEach((element) => {
                                element.classList.add("no-pointer")
                            })
                        }
                    }   
                }, 10)
            `)
        }
    }

    injectCode()
    const client = rpcDisabled ? null : await rpcLogin()
    const id = powerSaveBlocker.start('prevent-display-sleep')
    console.log('Power save blocker', powerSaveBlocker.isStarted(id))

    if (!client && !rpcDisabled) {
        console.error("Failed to login to Discord RPC")
    }


    client?.on("ready", async () => {
        client.user?.setActivity({
        details: "Playing",
        state: "Browsing the library",
        startTimestamp: Date.now()
        })
    })

    window.on("page-title-updated", (e, title) => {
        if (!process.argv.includes("--normal-user-agent")) {
            window.webContents.setUserAgent(userAgentWindows)
        }

        injectCode()

        e.preventDefault()
        if (title.includes("|")) {
            const gameName = title.split("|")[0].replaceAll("Play", "").trim()

            let state = gameName
            
            if (title.includes("  ")) {
                window.setFullScreen(true)
                state = "Playing " + gameName
            }


            client?.on("ready", async () => {
                client.user?.setActivity({
                details: "Playing",
                state,
                largeImageKey: "xbox",
                largeImageText: "Xbox Cloud Gaming on Linux (Electron)",
                startTimestamp: Date.now()
                })
            })
        } else {
            client?.on("ready", async () => {
                client.user?.setActivity({
                    details: "Playing",
                    state: "Browsing the library",
                    largeImageKey: "xbox",
                    largeImageText: "Xbox Cloud Gaming on Linux (Electron)",
                    startTimestamp: Date.now()
                })
            })
        }

    })
    client?.login();
    app.on("will-quit", async () => {
        globalShortcut.unregisterAll()
        client?.on("ready", async () => {
            await client.user?.clearActivity()
        })
    })

    app.on("window-all-closed", async () => {
        if (process.platform !== "darwin") {
            client?.on("ready", async () => {
                await client.user?.clearActivity()
            })
            app.quit()
        }
    })
})


