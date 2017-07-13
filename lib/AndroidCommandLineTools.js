const childProcess = require('child_process');
const path = require('path');

const DANGEROUS_PERMISSIONS = [
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
  'android.permission.CAMERA',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.GET_ACCOUNTS',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_PHONE_STATE',
  'android.permission.CALL_PHONE',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.ADD_VOICEMAIL',
  'android.permission.USE_SIP',
  'android.permission.PROCESS_OUTGOING_CALLS',
  'android.permission.BODY_SENSORS',
  'android.permission.SEND_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_WAP_PUSH',
  'android.permission.RECEIVE_MMS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE'
];

class AndroidCommandLineTools {

  /**
   * An interface for using android command line tools.
   * 
   * ```js
   * const cmd = new AndroidCommandLineTools({
   *   // Path to the android SDK folder. Defaults to 
   *   // process.env.ANDROID_HOME.
   *   sdkPath: process.env.ANDROID_HOME,
   * 
   *   // The name of the device to command. This can be omitted here
   *   // and set later by assigning a value to cmd.deviceName. You can
   *   // also give the device name for each individual method.
   *   deviceName: 'emulator-5554',
   *  
   *   // This is only needed if you want to start emulators using
   *   // startDevice method.
   *   avdName: 'Sony_xperia_z5_compact_API_23'
   * });
   * ```
   */
  constructor({sdkPath, deviceName, avdName} = {}) {
    this.sdkPath = sdkPath || process.env.ANDROID_HOME;
    this.deviceName = deviceName;
    this.avdName = avdName;
  }

  get adbPath() {
    return path.join(this.sdkPath, 'platform-tools', 'adb');
  }

  get emulatorPath() {
    return path.join(this.sdkPath, 'emulator', 'emulator');
  }

  startDevice({avdName} = {}) {
    avdName = avdName || this.avdName;

    this.spawn(`${this.emulatorPath}`, ['-avd', avdName || this.avdName], {
      stdio: 'ignore'
    });

    // Wait until the device is running.
    const waitUntilRunning = (attempt = 0) => {
      // If we get a list of packges from the packge manager we are good to go.
      return this.listPackages().then(list => {
        // listPackages should always return some items. If an empty list is
        // received the device is not yet running "properly".
        if (list.length === 0) {
          throw new Error();
        }
      }).catch(err => {
        if (attempt < 60) {
          return new Promise(resolve => setTimeout(resolve, 1000)).then(() => {
            return waitUntilRunning(attempt + 1);
          });
        } else {
          throw err;
        }
      });
    };

    return waitUntilRunning();
  }

  listRunningDevices() {
    return this
      .execAdb({
        cmd: 'devices'
      })
      .then(res => {
        const stdout = res.stdout;
        const lines = stdout.split(/\r?\n/);

        return lines.slice(1).map(line => {
          const parts = line.trim().split(/\s/);
          return parts[0].trim();
        }).filter(device => !!device);
      })
  }

  installApp({deviceName, packageName, apkPath}) {
    deviceName = deviceName || this.deviceName;

    return this
      .execAdb({
        deviceName, 
        cmd: `uninstall ${packageName}`
      })
      .catch(() => {
        // We get here if the app is not installed.
        // Simply ignore the error and continue.
      })
      .then(() => {
        return this.execAdb({
          deviceName,
          cmd: `install ${apkPath}`
        });
      });
  }

  listPackages({deviceName} = {}) {
    deviceName = deviceName || this.deviceName;

    return this
      .execAdb({
        deviceName,
        cmd: `shell pm list packages`
      })
      .then(res => {
        return res.stdout.split(/\r?\n/).map(it => it.trim()).filter(it => !!it);
      });
  }

  packageInfo({deviceName, packageName}) {
    deviceName = deviceName || this.deviceName;

    return this
      .execAdb({
        deviceName,
        cmd: `shell dumpsys package ${packageName}`
      })
      .then(res => {
        const stdout = res.stdout;
        const rows = stdout.split(/\r?\n/).map(row => row.trim());
        const startIdx = rows.findIndex(row => row === 'requested permissions:') + 1;
        const endIndex = rows.findIndex(row => row === 'install permissions:');

        return {
          requestedPermissions: rows.slice(startIdx, endIndex)
        };
      });
  }

  clearApp({deviceName, packageName}) {
    deviceName = deviceName || this.deviceName;

    return this.execAdb({
      deviceName,
      cmd: `shell pm clear ${packageName}`
    });
  }

  startApp({deviceName, packageName}) {
    deviceName = deviceName || this.deviceName;

    return this.execAdb({
      deviceName,
      cmd: `shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
    });
  }

  grantPermissions({deviceName, packageName, permissions}) {
    deviceName = deviceName || this.deviceName;
    // We only need to grant dangerous permissions.
    const dangerous = permissions.filter(permission => DANGEROUS_PERMISSIONS.includes(permission));

    return Promise.all(dangerous.map(permission => {
      return this.execAdb({
        deviceName,
        cmd: `shell pm grant ${packageName} ${permission}`
      });
    }))
  }

  tcpPortForward({deviceName, hostPort, devicePort}) {
    deviceName = deviceName || this.deviceName;

    return this.execAdb({
      deviceName,
      cmd: `forward tcp:${hostPort} tcp:${devicePort}`
    });
  }

  reverseTcpPortForward({deviceName, hostPort, devicePort}) {
    deviceName = deviceName || this.deviceName;

    return this.execAdb({
      deviceName,
      cmd: `reverse tcp:${devicePort} tcp:${hostPort}`
    });
  }

  execAdb({cmd, deviceName}) {
    deviceName = deviceName || this.deviceName;

    if (!deviceName) {
      throw new Error('missing deviceName');
    }

    return exec(`${this.adbPath} -s ${deviceName} ${cmd}`);
  }

  spawn(...args) {
    return childProcess.spawn(...args);
  }
}

function exec(cmd) {
  return new Promise((resolve, reject) => {
    childProcess.exec(cmd, {maxBuffer: 1024 * 1024}, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        if (stdout.toLowerCase().indexOf('error') === 0) {
          reject(new Error(stdout));
        } else if (stderr.toLowerCase().indexOf('error') === 0)  {
          reject(new Error(stderr));
        } else {
          resolve({stdout, stderr});
        }
      }
    });
  });
}

module.exports = {
  AndroidCommandLineTools
};