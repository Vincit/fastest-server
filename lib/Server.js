const express = require('express');
const request = require('yaquest');
const bodyParser = require('body-parser');
const { AndroidCommandLineTools } = require('./AndroidCommandLineTools');

class Server {

  static get AndroidCommandLineTools() {
    return AndroidCommandLineTools;
  }

  constructor({port, appServerPort, localAppServerPort, rootPath, sdkPath} = {}) {
    this.port = port || 4723;
    this.appServerPort = appServerPort || 7100;
    this.localAppServerPort = localAppServerPort || 6100;
    this.rootPath = rootPath || '/wd/hub';
    this.sdkPath = sdkPath;

    this.caps = null;
    this.appInfo = null;

    this.app = this.createExpress();
    this.server = null;
  }

  start() {
    return new Promise(resolve => {
      this.server = this.app.listen(this.port, resolve);
    });
  }

  stop() {
    return new Promise(resolve => this.server.close(resolve));
  }

  createExpress() {
    const app = express().use(bodyParser.json());

    app.post(`${this.rootPath}/session`, (req, res, next) => {
      this.createSession(req, res, next);
    });

    app.post(`${this.rootPath}/session/:id/appium/app/reset`, (req, res, next) => {
      this.resetApp(req, res, next);
    });

    app.use((req, res, next) => {
      this.forwardRequestToAppServer(req, res, next);
    });

    app.use((err, req, res, next) => {
      this.handleError(err, req, res, next);
    });

    return app;
  }

  createSession(req, res, next) {
    const caps = req.body.desiredCapabilities;
    this.caps = caps;

    const cmd = new this.constructor.AndroidCommandLineTools({
      deviceName: caps.deviceName,
      avdName: caps.avdName,
      sdkPath: this.sdkPath
    });

    cmd.listRunningDevices().then(runningDevices => {
      if (!runningDevices.includes(caps.deviceName)) {
        return cmd.startDevice();
      }
    }).then(() => {
      return cmd.installApp({
        packageName: caps.packageName,
        apkPath: caps.app 
      });
    }).then(() => {
      return cmd.packageInfo({
        packageName: caps.packageName
      });
    }).then(info => {
      this.appInfo = info;

      if (caps.platformVersion >= '6.0') {
        return cmd.grantPermissions({
          packageName: caps.packageName,
          permissions: info.requestedPermissions
        });
      }
    }).then(() => {
      return cmd.startApp({
        packageName: caps.packageName
      });
    }).then(() => {
      return cmd.tcpPortForward({
        hostPort: this.localAppServerPort,
        devicePort: this.appServerPort
      });
    }).then(() => {
      return this.waitForAppServerStart();
    }).then(() => {
      next();
    }).catch(err => {
      next(err);
    });
  }

  resetApp(req, res, next) {
    const caps = this.caps;
    const appInfo = this.appInfo;

    const cmd = new this.constructor.AndroidCommandLineTools({
      deviceName: caps.deviceName,
      avdName: caps.avdName,
      sdkPath: this.sdkPath
    });

    cmd.clearApp(caps).then(() => {
      if (caps.platformVersion >= '6.0') {
        return cmd.grantPermissions({
          packageName: caps.packageName,
          permissions: appInfo.requestedPermissions
        });
      }
    }).then(() => {
      return cmd.startApp({
        packageName: caps.packageName
      });
    }).then(() => {
      return this.waitForAppServerStart();
    }).then(() => {
      next();
    }).catch(err => {
      next(err);
    });
  }

  forwardRequestToAppServer(req, res, next) {
    const method = req.method.toLowerCase();
    const url = this.appServerUrl(req.path);

    request[method](url)
      .send(req.body)
      .then(deviceRes => {
        res.status(deviceRes.status).send(deviceRes.body);
      })
      .catch(err => {
        if (err.res) {
          res.status(err.res.status).send(err.res.body);
        } else {
          next(err);
        }
      });
  }

  handleError(err, req, res, next) {
    if (!err) {
      next();
    } else {
      console.error(req.method, req.path, err.stack);
      res.status(500).send({
        error: err.message,
        stack: err.stack
      });
    }
  }

  waitForAppServerStart(count = 0) {
    return delay(200).then(() => {
      return reflect(request.get(this.appServerUrl('/ping')));
    }).then(res => {
      if (res.isRejected()) {
        if (count < 50) {
          return this.waitForAppServerStart(count + 1);
        } else {
          return Promise.reject(res.reason());
        }
      }
    });
  }

  appServerUrl(path) {
    return `http://localhost:${this.localAppServerPort}${path}`;
  }
}

function delay(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

function createInspector(err) {
  return {
    isRejected() {
      return err !== null;
    },

    reason() {
      return err;
    }
  };
};

function reflect(promise) {
  return promise
    .then(res => createInspector(null))
    .catch(err => createInspector(err));
}

module.exports = {
  Server
};