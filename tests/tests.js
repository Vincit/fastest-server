const uuid = require('uuid');
const expect = require('expect.js');
const express = require('express');
const bodyParser = require('body-parser');

const { Server } = require('../');
const { Tester } = require('fastest-tester');

describe('Fastest server', () => {
  const port = 4723;
  const localAppServerPort = 6100;
  const sdkPath = '/foo/bar'
  
  let adbCalls = [];
  let adbResults = [];
  let spawnCalls = []; 

  let server;
  let appServer;

  const newElementId = () => `element-${uuid.v4()}`;

  class MockAndroidCommandLineTools extends Server.AndroidCommandLineTools {
    execAdb({cmd}) {
      adbCalls.push(cmd);
      return Promise.resolve({
        stdout: adbResults.shift(),
        stderr: ''
      });
    }

    spawn(...args) {
      spawnCalls.push(args);
    }
  }

  class MockServer extends Server {
    static get AndroidCommandLineTools() {
      return MockAndroidCommandLineTools;
    }
  }

  before(() => {
    server = new MockServer({
      port,
      localAppServerPort,
      sdkPath
    }); 

    return server.start();   
  });

  before(done => {
    appServer = express();
    appServer.use(bodyParser.json());

    appServer.requests = [];
    appServer.responses = [];

    appServer.use((req, res) => {
      appServer.requests.push({
        method: req.method,
        path: req.path,
        body: req.body
      });

      res.send(appServer.responses.shift());
    });

    appServer.server = appServer.listen(localAppServerPort, done);
  });

  after(done => {
    appServer.server.close(done);
  });

  beforeEach(() => {
    reset();
  });

  const reset = () => {
    appServer.responses = [];
    appServer.requests = [];
    
    adbCalls = [];
    adbResults = [];
    spawnCalls = []; 
  };

  describe('init', () => {

    it('device not running', () => {
      const tester = new Tester({
        serverUrl: `http://localhost:${port}`,
        deviceName: 'emulator-5554',
        packageName: 'fi.foo.bar',
        avdName: 'super-duper-avd',
        app: '/path/to/app.apk',
        platformVersion: '6.0'
      });

      appServer.responses = [
        // ping
        {},

        // session
        {sessionId: 'session-id'}
      ];

      adbResults = [
        // devices
        `List of devices attached
        emulator-007 somecrap`,

        // shell pm list packages
        `not.our.package`,

        // uninstall fi.foo.bar
        ``,

        // install /path/to/app.apk
        ``,

        // shell dumpsys package fi.foo.bar
        `
          requested permissions:
          fi.some.permission
          fi.some.other.permission
          install permissions:
        `,

        // shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1
        ``,

        // forward tcp:6100 tcp:7100
        ``,
      ];

      return tester.init().then(() => {
        expect(adbCalls).to.eql([ 
          'devices',
          'shell pm list packages',
          'uninstall fi.foo.bar',
          'install /path/to/app.apk',
          'shell dumpsys package fi.foo.bar',
          'shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1',
          'forward tcp:6100 tcp:7100'
        ]);

        expect(spawnCalls).to.have.length(1);
        expect(spawnCalls[0]).to.eql([
          "/foo/bar/emulator/emulator", [
            '-avd',
            'super-duper-avd'
          ], {
            stdio: 'ignore'
          }
        ]);

        expect(appServer.requests).to.eql([{
          method: 'GET',
          path: '/ping',
          body: {}
        }, {
          method: 'POST',
          path: '/wd/hub/session',
          body: {
            desiredCapabilities: {
              serverUrl: 'http://localhost:4723',
              deviceName: 'emulator-5554',
              packageName: 'fi.foo.bar',
              avdName: 'super-duper-avd',
              app: '/path/to/app.apk',
              platformVersion: '6.0'
            }
          }
        }]);
      });
    });

    it('device already running', () => {
      const tester = new Tester({
        serverUrl: `http://localhost:${port}`,
        deviceName: 'emulator-5554',
        packageName: 'fi.foo.bar',
        app: '/path/to/app.apk',
        platformVersion: '6.0'
      });

      // Response to the `ping` request that determines if the
      // app server is running.
      appServer.responses = [
        {}
      ];

      adbResults = [
        // devices
        `List of devices attached
        emulator-5554 somecrap`,

        // uninstall fi.foo.bar
        ``,

        // install /path/to/app.apk
        ``,

        // shell dumpsys package fi.foo.bar
        `
          requested permissions:
          fi.some.permission
          fi.some.other.permission
          install permissions:
        `,

        // shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1
        ``,

        // forward tcp:6100 tcp:7100
        ``,
      ];

      return tester.init().then(() => {
        expect(adbCalls).to.eql([ 
          'devices',
          'uninstall fi.foo.bar',
          'install /path/to/app.apk',
          'shell dumpsys package fi.foo.bar',
          'shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1',
          'forward tcp:6100 tcp:7100'
        ]);

        expect(spawnCalls).to.have.length(0);

        expect(appServer.requests).to.eql([{
          method: 'GET',
          path: '/ping',
          body: {}
        }, {
          method: 'POST',
          path: '/wd/hub/session',
          body: {
            desiredCapabilities: {
              serverUrl: 'http://localhost:4723',
              deviceName: 'emulator-5554',
              packageName: 'fi.foo.bar',
              app: '/path/to/app.apk',
              platformVersion: '6.0'
            }
          }
        }]);
      });
    });

    it('should grant missing dangerous permissions', () => {
      const tester = new Tester({
        serverUrl: `http://localhost:${port}`,
        deviceName: 'emulator-5554',
        packageName: 'fi.foo.bar',
        app: '/path/to/app.apk',
        platformVersion: '6.0'
      });

      appServer.responses = [
        // ping
        {},

        // session
        {sessionId: 'session-id'}
      ];

      adbResults = [
        // devices
        `List of devices attached
        emulator-5554 somecrap`,

        // uninstall fi.foo.bar
        ``,

        // install /path/to/app.apk
        ``,

        // shell dumpsys package fi.foo.bar
        `
          requested permissions:
          android.permission.RECORD_AUDIO
          android.permission.USE_SIP
          install permissions:
        `,

        // shell pm grant fi.foo.bar android.permission.RECORD_AUDIO
        ``,

        // shell pm grant fi.foo.bar android.permission.USE_SIP
        ``,

        // shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1
        ``,

        // forward tcp:6100 tcp:7100
        ``,
      ];

      return tester.init().then(() => {
        expect(adbCalls).to.eql([ 
          'devices',
          'uninstall fi.foo.bar',
          'install /path/to/app.apk',
          'shell dumpsys package fi.foo.bar',
          'shell pm grant fi.foo.bar android.permission.RECORD_AUDIO',
          'shell pm grant fi.foo.bar android.permission.USE_SIP',
          'shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1',
          'forward tcp:6100 tcp:7100'
        ]);

        expect(spawnCalls).to.have.length(0);

        expect(appServer.requests).to.eql([{
          method: 'GET',
          path: '/ping',
          body: {}
        }, {
          method: 'POST',
          path: '/wd/hub/session',
          body: {
            desiredCapabilities: {
              serverUrl: 'http://localhost:4723',
              deviceName: 'emulator-5554',
              packageName: 'fi.foo.bar',
              app: '/path/to/app.apk',
              platformVersion: '6.0'
            }
          }
        }]);
      });
    });

  });

  describe('resetApp', () => {
    let tester;

    beforeEach(() => {
      appServer.responses = [
        // ping
        {},

        // session
        {sessionId: 'session-id'}
      ];

      adbResults = [
        // devices
        `List of devices attached
        emulator-5554 somecrap`,

        // uninstall fi.foo.bar
        ``,

        // install /path/to/app.apk
        ``,

        // shell dumpsys package fi.foo.bar
        `
          requested permissions:
          android.permission.RECORD_AUDIO
          android.permission.USE_SIP
          install permissions:
        `,

        // shell pm grant fi.foo.bar android.permission.RECORD_AUDIO
        ``,

        // shell pm grant fi.foo.bar android.permission.USE_SIP
        ``,

        // shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1
        ``,

        // forward tcp:6100 tcp:7100
        ``,
      ];

      tester = new Tester({
        serverUrl: `http://localhost:${port}`,
        deviceName: 'emulator-5554',
        packageName: 'fi.foo.bar',
        app: '/path/to/app.apk',
        platformVersion: '6.0'
      });

      return tester.init();
    });

    beforeEach(() => {
      reset();
    });

    it('should reset app', () => {
      appServer.responses = [
        // ping
        {}
      ];

      adbResults = [
        // shell pm clear fi.foo.bar
        ``,

        // shell pm grant fi.foo.bar android.permission.RECORD_AUDIO
        ``,

        // shell pm grant fi.foo.bar android.permission.USE_SIP
        ``,

        // shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1
        ``
      ];

      return tester.resetApp().then(() => {
        expect(adbCalls).to.eql([ 
          'shell pm clear fi.foo.bar',
          'shell pm grant fi.foo.bar android.permission.RECORD_AUDIO',
          'shell pm grant fi.foo.bar android.permission.USE_SIP',
          'shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1'
        ]);

        expect(spawnCalls).to.have.length(0);

        expect(appServer.requests).to.eql([{
          method: 'GET',
          path: '/ping',
          body: {}
        }, {
          method: 'POST',
          path: '/wd/hub/session/session-id/appium/app/reset',
          body: {}
        }]);
      });
    });

  });

  describe('test methods', () => {
    let tester;

    beforeEach(() => {
      appServer.responses = [
        // ping
        {},

        // session
        {sessionId: 'session-id'}
      ];

      adbResults = [
        // devices
        `List of devices attached
        emulator-5554 somecrap`,

        // uninstall fi.foo.bar
        ``,

        // install /path/to/app.apk
        ``,

        // shell dumpsys package fi.foo.bar
        `
          requested permissions:
          android.permission.RECORD_AUDIO
          android.permission.USE_SIP
          install permissions:
        `,

        // shell pm grant fi.foo.bar android.permission.RECORD_AUDIO
        ``,

        // shell pm grant fi.foo.bar android.permission.USE_SIP
        ``,

        // shell monkey -p fi.foo.bar -c android.intent.category.LAUNCHER 1
        ``,

        // forward tcp:6100 tcp:7100
        ``,
      ];

      tester = new Tester({
        serverUrl: `http://localhost:${port}`,
        deviceName: 'emulator-5554',
        packageName: 'fi.foo.bar',
        app: '/path/to/app.apk',
        platformVersion: '6.0'
      });

      return tester.init();
    });

    beforeEach(() => {
      reset();
    });

    it('elements', () => {
      appServer.responses = [
        {
          value: [{
            element: newElementId()
          }]
        }
      ];

      return tester
        .elementsByXpath('some selector')
        .then(() => {
          expect([{ 
            method: 'POST',
            path: '/wd/hub/session/session-id/elements',
            body: {
              using: 'xpath',
              value: 'some selector'
            } 
          }]);
        });
    });

  });

});