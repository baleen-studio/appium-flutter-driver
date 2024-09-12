import { URL } from 'url';
import _ from 'lodash';
import type { FlutterDriver } from '../driver';
import { IsolateSocket } from './isolate_socket';
import { decode } from './base64url';
import type { LogEntry } from './log-monitor';

const truncateLength = 500;
// https://github.com/flutter/flutter/blob/f90b019c68edf4541a4c8273865a2b40c2c01eb3/dev/devicelab/lib/framework/runner.dart#L183
//  e.g. 'Observatory listening on http://127.0.0.1:52817/_w_SwaKs9-g=/'
// https://github.com/flutter/flutter/blob/52ae102f182afaa0524d0d01d21b2d86d15a11dc/packages/flutter_tools/lib/src/resident_runner.dart#L1386-L1389
//  e.g. 'An Observatory debugger and profiler on ${device.device.name} is available at: http://127.0.0.1:52817/_w_SwaKs9-g=/'
export const OBSERVATORY_URL_PATTERN = new RegExp(
  `(Observatory listening on |` +
  `An Observatory debugger and profiler on\\s.+\\sis available at: |` +
  `The Dart VM service is listening on )` +
  `((http|//)[a-zA-Z0-9:/=_\\-.\\[\\]]+)`,
);

export let globalDartObservatoryURL: string;
// SOCKETS
export async function connectSocket(
  this: FlutterDriver,
  dartObservatoryURL: string,
  caps: Record<string, any>
): Promise<IsolateSocket> {
  const isolateId = caps.isolateId;

  this.log.debug(`Establishing a connection to the Dart Observatory`);
      
  const connectedPromise = new Promise<IsolateSocket | null>((resolve) => {
    const socket = new IsolateSocket(dartObservatoryURL);
      
    const removeListenerAndResolve = (r: IsolateSocket | null) => {
      socket.removeListener(`error`, onErrorListener);
      socket.removeListener(`timeout`, onTimeoutListener);
      socket.removeListener(`open`, onOpenListener);
      resolve(r);
    };
      
    // Add an 'error' event handler for the client socket
    const onErrorListener = (ex: Error) => {
      this.log.error(`Connection to ${dartObservatoryURL} got an error: ${ex.message}`);
      removeListenerAndResolve(null);
    };
    socket.on(`error`, onErrorListener);
    // Add a 'close' event handler for the client socket
    socket.on(`close`, () => {
      this.log.info(`Connection to ${dartObservatoryURL} closed`);
      // @todo do we need to set this.socket = null?
    });
    // Add a 'timeout' event handler for the client socket
    const onTimeoutListener = () => {
      this.log.error(`Connection to ${dartObservatoryURL} timed out`);
      removeListenerAndResolve(null);
    };
    socket.on(`timeout`, onTimeoutListener);
    const onOpenListener = async () => {
      const originalSocketCall = socket.call;
      socket.call = async (...args: any) => {
        try {
          // `await` is needed so that rejected promise will be thrown and caught
          return await originalSocketCall.apply(socket, args);
        } catch (e) {
          this.log.errorAndThrow(JSON.stringify(e));
        }
      };
      this.log.info(`Connecting to Dart Observatory: ${dartObservatoryURL}`);
      
      if (isolateId) {
        this.log.info(`Listing the given isolate id: ${isolateId}`);
        socket.isolateId = isolateId;
      } else {
        const vm = await socket.call(`getVM`) as {
          isolates: [{
            name: string,
            id: number,
          }],
        };
        this.log.info(`Listing all isolates: ${JSON.stringify(vm.isolates)}`);
        // To accept 'main.dart:main()' and 'main'
        const mainIsolateData = vm.isolates.find((e) => e.name.includes(`main`));
        if (!mainIsolateData) {
          this.log.error(`Cannot get Dart main isolate info`);
          removeListenerAndResolve(null);
          socket.close();
          return;
        }
        // e.g. 'isolates/2978358234363215', '2978358234363215'
        socket.isolateId = mainIsolateData.id;
      }
        
      // @todo check extension and do health check
      const isolate = await socket.call(`getIsolate`, {
        isolateId: `${socket.isolateId}`,
      }) as {
        extensionRPCs: [string] | null,
      } | null;
      if (!isolate) {
        this.log.error(`Cannot get main Dart Isolate`);
        removeListenerAndResolve(null);
        return;
      }
      if (!Array.isArray(isolate.extensionRPCs)) {
        this.log.error(`Cannot get Dart extensionRPCs from isolate ${JSON.stringify(isolate)}`);
        removeListenerAndResolve(null);
        return;
      }
      if (isolate.extensionRPCs.indexOf(`ext.flutter.driver`) < 0) {
        this.log.error(
          `"ext.flutter.driver" is not found in "extensionRPCs" ${JSON.stringify(isolate.extensionRPCs)}`
        );
        removeListenerAndResolve(null);
        return;
      }
      removeListenerAndResolve(socket);
    };
    socket.on(`open`, onOpenListener);
  });

  const connectedSocket = await connectedPromise;
  if (connectedSocket) {
    return connectedSocket;
  }

  throw new Error(
    `Cannot connect to the Dart Observatory URL ${dartObservatoryURL}. ` +
    `Check the server log for more details`
  );
}

export async function executeGetIsolateCommand(
    this: FlutterDriver,
  isolateId: string|number
) {
  this.log.debug(`>>> getIsolate`);
  const isolate = await (this.socket as IsolateSocket).call(`getIsolate`, { isolateId: `${isolateId}` });
  this.log.debug(`<<< ${_.truncate(JSON.stringify(isolate), {'length': truncateLength})}`);
  return isolate;
};

export async function executeGetVMCommand(this: FlutterDriver) {
  this.log.debug(`>>> getVM`);
  const vm = await (this.socket as IsolateSocket).call(`getVM`) as {
    isolates: [{
      name: string,
      id: number,
    }],
  };
  this.log.debug(`<<< ${_.truncate(JSON.stringify(vm), {'length': truncateLength})}`);
  return vm;
}

export async function executeElementCommand(
  this: FlutterDriver,
  command: string,
  elementBase64?: string,
  extraArgs = {}
  ) {
  
  const regexp = new RegExp("^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$");
  let elementObject;
  let serializedCommand;
  try {
    if (regexp.test(elementBase64!)) {
      elementObject = elementBase64 ? JSON.parse(decode(elementBase64)) : {};
    } else {
      elementObject = elementBase64 ? JSON.parse(elementBase64) : {};
    }
    if (Array.isArray(elementObject)) {
      serializedCommand = { command, ...elementObject, ...extraArgs };
    } else {
      serializedCommand = { command, 'id':elementObject, ...extraArgs };
    }
  } catch (e) {
    if (regexp.test(elementBase64!)) {
      serializedCommand = { command, "id": decode(elementBase64!), ...extraArgs };
    } else {
      serializedCommand = { command, "id": elementBase64, ...extraArgs };
    }
  }

  const response = await this.execute(`flutter:requestData`,  ['getFinderType:' + JSON.stringify(serializedCommand)]);
  let mess = JSON.parse(response.response.message);
  serializedCommand['finderType'] = mess['foundBy'].replace('by', 'By');
  switch(mess['foundBy']) {
    case 'byType':
      serializedCommand['type'] = mess['text'];
      break;
    case 'byToolTip':
      serializedCommand['finderType'] = 'ByTooltipMessage';
      serializedCommand['text'] = mess['text'];
      break;
    case 'bySemanticsLabel':
      serializedCommand['label'] = mess['text'];
      break;
    case 'byValueKey':
      let key = mess['text'];
      let idx = key.indexOf("[<'");
      if (idx == 0) {
        let last = key.indexOf("'>]");
        if (last > 0) {
          key = key.substring("[<'".length, last);
        }
      }
      serializedCommand['keyValueString'] = key;
      serializedCommand['keyValueType'] = 'String';
      break;
    default:
      serializedCommand['text'] = mess['text'];
  }

  this.log.debug(`>>> ${JSON.stringify(serializedCommand)}`);
  const data = await (this.socket as IsolateSocket).executeSocketCommand(serializedCommand);
  this.log.debug(`<<< ${JSON.stringify(data)} | previous command ${command}`);
    if (data.isError) {
    throw new Error(
      `Cannot execute command ${command}, server response ${JSON.stringify(data, null, 2)}`,
    );
  }
  return data.response;
}

export function extractObservatoryUrl(logEntry: LogEntry): URL | null {
  const match = logEntry.message.match(OBSERVATORY_URL_PATTERN);
  if (!match) {
    return null;
  }

  try {
    const result = new URL(match[2]);
    result.protocol = `ws`;
    result.pathname += `ws`;
    return result;
  } catch (ign) {
    return null;
  }
}
