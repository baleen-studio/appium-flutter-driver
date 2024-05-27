import type { FlutterDriver } from '../driver';
import { createSession, reConnectFlutterDriver } from '../sessions/session';
import { PLATFORM } from '../platform';

export const getScreenshot = async function(this: FlutterDriver) {
  // re-create the port forward
  var response;
  switch (this.internalCaps.platformName.toLowerCase()) {
    case PLATFORM.IOS:
      //response = await this.execute(`flutter:requestData`, ['screenShot']) as any;
      //return response.response.message;
      return this.proxydriver.getScreenshot();
    case PLATFORM.ANDROID:
      response = await this.socket!.call(`_flutter.screenshot`) as any;
      return response.screenshot;
  }
};

export const getWindowRect = async function(this: FlutterDriver) {
  const response = await this.execute(`flutter:requestData`, ['getScreenSize']) as any;
  var mess = JSON.parse(response.response.message);
  var ret = {'height':mess.height,'width':mess.width,'x':0,'y':0};
  return ret;
};

export const getPageSource = async function(this: FlutterDriver) {
  const response = await this.execute(`flutter:requestData`, ['getPageSource']) as any;
  return response.response.message;
};

export const performActions = async function(this: FlutterDriver, actions: string) {
  if (typeof actions != 'string') {
    actions = JSON.stringify(actions);
  }

  const json = JSON.parse(actions);
  const performs = json[0];
  const type = performs['type'];
  const id = performs['id'];
  const parameters = performs['parameters'];
  const pointerType = parameters['pointerType'];
  const commands = performs['actions'];

  let x;
  let y;
  let duration = 0;
  for (const command of commands) {
    const type = command['type'];
    switch (type) {
      case 'pointerMove':
        x = command['x'];
        y = command['y'];
        break;
      case 'pointerDown':
        break;
      case 'pause':
        duration = command['duration'];
      case 'pointerUp':
        const params = {
          "command":"tap","finderType":"ByTooltipMessage","text":"Increment"
        };
        const data = await this.socket!.executeSocketCommand(params);
        return data;
    }
  }

//  const response = await this.execute(`flutter:requestData`, ['performActions:'+actions]) as any;
//  return response;
}
