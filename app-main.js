/*
**  Live Video Experience (LiVE)
**  Copyright (c) 2020 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external requirements  */
const electron     = require("electron")
const path         = require("path")
const EventEmitter = require("eventemitter2")
const imageDataURI = require("image-data-uri")
const throttle     = require("throttle-debounce").throttle
const UUID         = require("pure-uuid")

/*  internal requirements  */
const Settings     = require("./app-main-settings")
const VideoStream  = require("./app-main-relay-videostream")
const EventStream  = require("./app-main-relay-eventstream")

/*  enter an asynchronous environment in main process  */
;(async () => {
    /*   establish Electron application  */
    const app = electron.app
    app.allowRendererProcessReuse = true
    app.on("ready", async () => {
        /*  establish settings and their default values  */
        const clientId   = (new UUID(1)).format("std")
        const settings = new Settings({ appId: "LiVE-Receiver", flushAfter: 1 * 1000 })
        settings.load()
        app.clientId             = settings.get("client-id",              clientId)
        app.x                    = settings.get("window-x",               100)
        app.y                    = settings.get("window-y",               100)
        app.w                    = settings.get("window-width",           1280 + 40)
        app.h                    = settings.get("window-height",          720  + 40)
        app.personPortrait       = settings.get("person-portrait",        "")
        app.personName           = settings.get("person-name",            "")
        app.liveRelayServer      = settings.get("live-relay-server",      "")
        app.liveAccessToken      = settings.get("live-access-token",      "")
        app.liveStreamResolution = settings.get("live-stream-resolution", "1080p")
        app.liveStreamBuffering  = settings.get("live-stream-buffering",  2000)
        app.audioInputDevice     = settings.get("audio-input-device",     "")
        app.audioOutputDevice    = settings.get("audio-output-device",    "")

        /*  save back the settings once at startup  */
        settings.set("client-id",              app.clientId)
        settings.set("window-x",               app.x)
        settings.set("window-y",               app.y)
        settings.set("window-width",           app.w)
        settings.set("window-height",          app.h)
        settings.set("person-portrait",        app.personPortrait)
        settings.set("person-name",            app.personName)
        settings.set("live-relay-server",      app.liveRelayServer)
        settings.set("live-access-token",      app.liveAccessToken)
        settings.set("live-stream-resolution", app.liveStreamResolution)
        settings.set("live-stream-buffering",  app.liveStreamBuffering)
        settings.set("audio-input-device",     app.audioInputDevice)
        settings.set("audio-output-device",    app.audioOutputDevice)
        settings.save()

        /*  initialize global information  */
        app.win       = null
        app.connected = false

        /*  provide APIs for renderer process  */
        app.ipc   = electron.ipcMain
        app.event = new EventEmitter({ wildcard: true })

        /*  provide helper functions for renderer  */
        app.ipc.handle("settings", async (event, ...args) => {
            const old = settings.get(args[0])
            if (args.length === 2)
                settings.set(args[0], args[1])
            return old
        })
        app.ipc.handle("imageEncodeFromFile", async (event, filename) => {
            const data = await imageDataURI.encodeFromFile(path.resolve(__dirname, filename))
            return data
        })

        /*  redirect exception error boxes to the console  */
        electron.dialog.showErrorBox = (title, content) => {
            console.log(`++ LiVE-Relay: exception: ${title}: ${content}`)
        }

        /*  create application window  */
        app.win = new electron.BrowserWindow({
            useContentSize: true,
            frame:          false,
            transparent:    true,
            show:           false,
            x:              app.x,
            y:              app.y,
            width:          app.w,
            height:         app.h,
            minWidth:       1000,
            minHeight:      650,
            resizable:      true,
            webPreferences: {
                nodeIntegration:    true,
                enableRemoteModule: true,
                autoplayPolicy:     "no-user-gesture-required"
            }
        })
        app.win.setHasShadow(true)
        app.win.loadURL(`file://${__dirname}/app-ui.html`)
        if (process.env.DEBUG) {
            require("vue-devtools").install()
            app.win.webContents.openDevTools()
        }
        app.win.on("ready-to-show", () => {
            app.win.show()
            app.win.focus()
        })

        /*  react on implicit window close  */
        app.win.on("closed", () => {
        })

        /*  react on explicit window close  */
        app.ipc.handle("quit", (event) => {
            settings.save()
            app.quit()
        })

        /*  react on all windows closed  */
        app.on("window-all-closed", () => {
            settings.save()
            app.quit()
        })

        /*  track application window changes  */
        const updateBounds = () => {
            const bounds = app.win.getBounds()
            app.x = bounds.x
            app.y = bounds.y
            app.w = bounds.width
            app.h = bounds.height
            settings.set("window-x",      app.x)
            settings.set("window-y",      app.y)
            settings.set("window-width",  app.w)
            settings.set("window-height", app.h)
        }
        app.win.on("resize", throttle(1000, updateBounds))
        app.win.on("move",   throttle(1000, updateBounds))

        /*  allow UI command events to control application window  */
        app.ipc.handle("minimize", (event) => {
            if (app.win.isMinimized())
                app.win.restore()
            else
                app.win.minimize()
        })
        let maximized = false
        app.ipc.handle("maximize", (event) => {
            if (maximized) {
                app.win.unmaximize()
                maximized = false
            }
            else {
                app.win.maximize()
                maximized = true
            }
        })
        let fullscreened = false
        app.ipc.handle("fullscreen", (event) => {
            fullscreened = !fullscreened
            app.win.setFullScreen(fullscreened)
        })
        app.ipc.handle("resize", (event, diff) => {
            app.w += diff.x
            app.h += diff.y
            app.win.setSize(app.w, app.h)
        })
        app.ipc.handle("set-size", (event, size) => {
            app.w = size.w
            app.h = size.h
            app.win.setSize(app.w, app.h)
        })

        /*  the LiVE Relay VideoStream/EventStream communication establishment  */
        app.es = null
        app.vs = null
        const credentials = {
            client: app.clientId
        }
        const liveAuth = async () => {
            console.log("++ LiVE-Relay: authenticate")

            /*  connect to LiVE Relay EventStream  */
            const es = new EventStream(credentials)
            const result = await (es.preauth().then(() => ({ success: true })).catch((err) => {
                return { error: `Failed to authenticate at LiVE Relay service: ${err.message}` }
            }))
            if (result.error)
                return result
            return { success: true }
        }
        const liveConnect = async () => {
            if (app.connected) {
                console.log("++ LiVE-Relay: connect (ALREADY CONNECTED)")
                return { error: "invalid use -- already connected" }
            }
            console.log("++ LiVE-Relay: connect (begin)")

            /*  give UI some time to start stream processing  */
            app.win.webContents.send("stream-begin")
            await new Promise((resolve) => setTimeout(resolve, 1 * 1000))

            /*  connect to LiVE Relay EventStream  */
            const es = new EventStream(credentials)
            let result = await es.start().then(() => ({ success: true })).catch((err) => {
                return { error: `EventStream: MQTTS: start: ${err}` }
            })
            if (result.error)
                return result
            app.es = es

            /*  connect to LiVE Relay VideoStream  */
            const vs = new VideoStream(credentials)
            vs.on("segment", (num, id, user, buffer) => {
                if (!app.connected)
                    return
                // console.log(`-- LiVE-Relay: RTMPS segment #${num}: ${id} @ ${user.mimeCodec} (${buffer.byteLength} bytes)`)
                app.win.webContents.send("stream-data", { id, user, buffer })
            })
            vs.on("error", (err) => {
                if (!app.connected)
                    return
                console.log(`** LiVE-Relay: RTMPS: ERROR: ${err}`)
                app.win.webContents.send("stream-end")
            })
            result = await vs.start().then(() => ({ success: true })).catch((err) => {
                return { error: `VideoStream: RTMPS: start: ${err}` }
            })
            if (result.error)
                return result
            app.vs = vs

            /*  indicate success  */
            app.connected = true
            console.log("++ LiVE-Relay: connect (end)")
            return { success: true }
        }
        const liveDisconnect = async () => {
            if (!app.connected) {
                console.log("++ LiVE-Relay: disconnect (STILL NOT CONNECTED)")
                return { error: "invalid use -- still not connected" }
            }
            console.log("++ LiVE Relay: disconnect (begin)")

            /*  disconnect from LiVE Relay EventStream  */
            let result
            if (app.es !== null) {
                result = await app.es.stop().then(() => ({ success: true })).catch((err) => {
                    return { error: `EventStream: MQTTS: stop: ${err}` }
                })
                if (result.error)
                    return result
                app.es = null
            }

            /*  disconnect from LiVE Relay VideoStream  */
            if (app.vs !== null) {
                result = await app.vs.stop().then(() => ({ success: true })).catch((err) => {
                    return { error: `VideoStream: RTMPS: stop: ${err}` }
                })
                if (result.error)
                    return result
                app.vs = null
            }

            /*  give UI some time to stop stream processing  */
            app.win.webContents.send("stream-end")
            await new Promise((resolve) => setTimeout(resolve, 1 * 1000))

            /*  indicate success  */
            app.connected = false
            console.log("++ LiVE Relay: disconnect (end)")
            return { success: true }
        }
        app.ipc.handle("login", async (event, {
            personPortrait, personName, liveRelayServer,
            liveAccessToken, liveStreamResolution, liveStreamBuffering,
            audioInputDevice, audioOutputDevice
        }) => {
            /*  take login parameters  */
            app.personPortrait       = personPortrait
            app.personName           = personName
            app.liveRelayServer      = liveRelayServer
            app.liveAccessToken      = liveAccessToken
            app.liveStreamResolution = liveStreamResolution
            app.liveStreamBuffering  = liveStreamBuffering
            app.audioInputDevice     = audioInputDevice
            app.audioOutputDevice    = audioOutputDevice
            settings.set("person-portrait",        app.personPortrait)
            settings.set("person-name",            app.personName)
            settings.set("live-relay-server",      app.liveRelayServer)
            settings.set("live-access-token",      app.liveAccessToken)
            settings.set("live-stream-resolution", app.liveStreamResolution)
            settings.set("live-stream-buffering",  app.liveStreamBuffering)
            settings.set("audio-input-device",     app.audioInputDevice)
            settings.set("audio-output-device",    app.audioOutputDevice)

            /*  parse access token  */
            const m = app.liveAccessToken.match(/^(.+?)-([^-]+)-([^-]+)$/)
            if (m === null)
                return { error: "invalid access token format" }
            const [ , channel, token1, token2 ] = m

            /*  update LiVE Relay communication credentials  */
            credentials.server     = app.liveRelayServer
            credentials.channel    = channel
            credentials.token1     = token1
            credentials.token2     = token2
            credentials.resolution = app.liveStreamResolution
            credentials.buffering  = app.liveStreamBuffering

            /*  establish communication  */
            let result = await liveAuth()
            if (result.error)
                return result
            result = await liveConnect()
            if (result.error)
                return result
            return { success: true }
        })
        app.ipc.handle("logout", async (event) => {
            const result = await liveDisconnect()
            if (result.error)
                return result
            return { success: true }
        })

        /*  the LiVE Relay EventStream communication: messages  */
        app.ipc.handle("message", (event, message) => {
            if (app.es !== null) {
                app.es.send(JSON.stringify({
                    id:    "training",
                    event: "chat",
                    data: {
                        title:   app.personName,
                        image:   app.personPortrait,
                        message: message.message,
                        ...(message.audio ? { audio: message.audio } : {})
                    }
                }))
            }
        })

        /*  the LiVE Relay EventStream communication: feedback  */
        app.ipc.handle("feedback", (event, type) => {
            if (app.es !== null) {
                app.es.send(JSON.stringify({
                    id:    "training",
                    event: "feedback",
                    data: {
                        client: app.clientId,
                        type:   type
                    }
                }))
            }
        })

        /*  the LiVE Relay EventStream communication: feeling  */
        app.ipc.handle("feeling", (event, feeling) => {
            if (app.es !== null) {
                app.es.send(JSON.stringify({
                    id:    "training",
                    event: "feeling",
                    data: {
                        client:    app.clientId,
                        challenge: feeling.challenge,
                        mood:      feeling.mood
                    }
                }))
            }
        })
    })
})().catch((err) => {
    console.log(`** LiVE Receiver: main: ERROR: ${err}`)
})
