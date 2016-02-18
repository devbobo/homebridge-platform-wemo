/* jshint node: true */
// Wemo Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// Remember to add platform to config.json. Example:
// "platforms": [
//      {
//          "platform": "BelkinWeMo",
//          "name": "Belkin WeMo",
//          "expected_accessories": "", stop looking for wemo accessories after this many found (excluding Wemo Link(s))
//          "timeout": "" //defaults to 10 seconds that we look for accessories.
//          "no_motion_timer": 60 // optional: [WeMo Motion only] a timer (in seconds) which is started no motion is detected, defaults to 60
//          "homekit_safe" : "1" // optional: determines if we protect your homekit config if we can't find the expected number of accessories.
//      }
// ],

"use strict";

var Accessory, Characteristic, Consumption, Service, TotalConsumption, UUIDGen;
var Wemo = require('wemo-client');
var wemo = new Wemo();
var http = require('http');
//var debug = require('debug')('homebridge-platform-wemo');

var noMotionTimer;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    Consumption = function() {
        Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');

        this.setProps({
            format: Characteristic.Formats.UINT16,
            unit: 'W',
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    require('util').inherits(Consumption, Characteristic);
    
    Consumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

    TotalConsumption = function() {
        Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');

        this.setProps({
            format: Characteristic.Formats.UINT32,
            unit: 'kWh',
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    require('util').inherits(TotalConsumption, Characteristic);

    TotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

    homebridge.registerPlatform("homebridge-platform-wemo", "BelkinWeMo", WemoPlatform, true);
};

function WemoPlatform(log, config, api) {
    this.config = config || {};

    var self = this;

    this.api = api;
    this.accessories = {};
    this.log = log;

    noMotionTimer = this.config.no_motion_timer || 60;

    this.requestServer = http.createServer();
    this.requestServer.listen(18093, function() {
        self.log("Server Listening...");
    });

    var addDiscoveredDevice = function(device) {
        var uuid = UUIDGen.generate(device.UDN);
        var accessory;

        if (device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
            var client = this.client(device , self.log);

            client.getEndDevices(function (err, enddevices) {
                for (var i = 0, tot = enddevices.length; i < tot; i++) {
                    uuid = UUIDGen.generate(enddevices[i].deviceId);
                    accessory = self.accessories[uuid];

                    if (accessory === undefined) {
                        self.addLinkAccessory(device, enddevices[i]);
                    }
                    else {
                        self.log("Online: %s [%s]", accessory.displayName, device.deviceId);
                        self.accessories[uuid] = new WemoLinkAccessory(self.log, accessory, device, enddevices[i]);
                    }
                }
            });
        }
        else {
            accessory = self.accessories[uuid];

            if (accessory === undefined) {
                self.addAccessory(device);
            }
            else {
                self.log("Online: %s [%s]", accessory.displayName, device.macAddress);
                self.accessories[uuid] = new WemoAccessory(self.log, accessory, device);
            }
        }
    }

    this.api.on('didFinishLaunching', function() {
        wemo.discover(addDiscoveredDevice);
    });

    setInterval(
        function(){
            wemo.discover(addDiscoveredDevice);
        },
        60000
    );
}

WemoPlatform.prototype.addAccessory = function(device) {
    this.log("Found: %s [%s]", device.friendlyName, device.macAddress);

    var serviceType = getServiceType(device.deviceType);
    
    if (serviceType === undefined) {
        return;
    }

    var accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.UDN));
    var service = accessory.addService(serviceType);

    switch(device.deviceType) {
        case Wemo.DEVICE_TYPE.Insight:
            service.addOptionalCharacteristic(Characteristic.OutletInUse);
            service.addOptionalCharacteristic(Consumption);
            service.addOptionalCharacteristic(TotalConsumption);
            break;
        case Wemo.DEVICE_TYPE.Maker:
            service.addOptionalCharacteristic(Characteristic.ContactSensorState);
            break;
    }

    this.accessories[accessory.UUID] = new WemoAccessory(this.log, accessory, device);
    this.api.registerPlatformAccessories("homebridge-platform-wemo", "BelkinWeMo", [accessory]);
}

WemoPlatform.prototype.addLinkAccessory = function(link, device) {
    this.log("Found: %s [%s]", device.friendlyName, device.deviceId);

    var accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.deviceId));
    accessory.addService(Service.Lightbulb);

    this.accessories[accessory.UUID] = new WemoLinkAccessory(this.log, accessory, link, device);
    this.api.registerPlatformAccessories("homebridge-platform-wemo", "BelkinWeMo", [accessory]);
}

WemoPlatform.prototype.configureAccessory = function(accessory) {
    this.accessories[accessory.UUID] = accessory;
}

WemoPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
    var respDict = {};

    if (request && request.type === "Terminate") {
        context.onScreen = null;
    }

    switch(context.onScreen) {
        case "Remove":
            if (request.response.selections) {
                for (var i in request.response.selections.sort()) {
                    this.removeAccessory(this.sortedAccessories[request.response.selections[i]]);
                }

                this.sortedAccessories = null;

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Accessory removal was successful."
                }

                context.onScreen = "Complete";
                callback(respDict);
                break;
            }
        case "Complete":
        default:
            if (request && (request.response || request.type === "Terminate")) {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            else {
                this.sortedAccessories = Object.keys(this.accessories).map(
                    function(k){return this[k] instanceof Accessory ? this[k] : this[k].accessory},
                    this.accessories
                ).sort(function(a,b) {if (a.displayName < b.displayName) return -1; if (a.displayName > b.displayName) return 1; return 0});

                var names = Object.keys(this.sortedAccessories).map(function(k) {return this[k].displayName}, this.sortedAccessories);

                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select accessory to remove",
                    "allowMultipleSelection": true,
                    "items": names
                }

                context.onScreen = "Remove";
                callback(respDict);
            }
    }
}


WemoPlatform.prototype.removeAccessory = function(accessory) {
    this.log("Remove: %s", accessory.displayName);

    if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
    }

    this.api.unregisterPlatformAccessories("homebridge-platform-wemo", "BelkinWeMo", [accessory]);
}

function WemoAccessory(log, accessory, device) {
    var self = this;

    this.accessory = accessory;
    this.device = device;
    this.log = log;
    this.client = wemo.client(device, log);
    this.onState = false;

    accessory.updateReachability(true);

    this.service = this.getService();

    switch(device.deviceType) {
        case Wemo.DEVICE_TYPE.Insight:
            this.service
                .getCharacteristic(Characteristic.On)
                .on('get', function(callback) {callback(null, self.onState)})
                .on('set', this.setOn.bind(this));

            this.service
                .getCharacteristic(Characteristic.OutletInUse)
                .on('get', function(callback) {callback(null, self.inUse)});

            this.service
                .getCharacteristic(Consumption)
                .on('get', function(callback) {callback(null, self.powerUsage)});

            this.service
                .getCharacteristic(TotalConsumption)
                .on('get', function(callback) {callback(null, self.totalUsage)});

            break;
        case Wemo.DEVICE_TYPE.Maker:
            this.onSensor = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

            this.service
                .getCharacteristic(Characteristic.On)
                .on('get', function(callback) {callback(null, self.onState)})
                .on('set', this.setOn.bind(this));

            this.service
                .getCharacteristic(Characteristic.ContactSensorState)
                .on('get', function(callback) {callback(null, self.onSensor)});

            break;
        case Wemo.DEVICE_TYPE.Switch:
        case "urn:Belkin:device:lightswitch:1":
            this.service
                .getCharacteristic(Characteristic.On)
                .on('get', function(callback) {callback(null, self.onState)})
                .on('set', this.setOn.bind(this));

            break;
        case Wemo.DEVICE_TYPE.Motion:
        case "urn:Belkin:device:NetCamSensor:1":
            this.service.getCharacteristic(Characteristic.MotionDetected).on('get', function(callback) {callback(null, self.onState)});
            break;
        default:
            console.log("Not implemented");
    }

    this.accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Belkin WeMo")
        .setCharacteristic(Characteristic.Model, device.modelName)
        .setCharacteristic(Characteristic.SerialNumber, device.serialNumber)
        .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion);

    if (device.deviceType === Wemo.DEVICE_TYPE.Maker) {
        /* TODO: get initial state of WeMo Maker switch and sensor
        submitted a request for this method to be added to wemo-client
        https://github.com/timonreinhard/wemo-client/issues/24
        this.client.getAttributeList(function() {
        });
        */

        this.client.on('attributeList', function(name, value, prevalue, timestamp){
            switch(name) {
                case 'Switch':
                    self.onState = value > 0;

                    if (self.service) {
                        if (self.onState !== self._onState) {
                            self.service.getCharacteristic(Characteristic.On).setValue(self.onState);
                        }

                        self._onState = self.onState;
                    }
                    break;
                case 'Sensor':
                    self.onSensor = value > 0 ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED;

                    if (self.service) {
                        if (self.onSensor !== self._onSensor) {
                            self.service.getCharacteristic(Characteristic.ContactSensorState).setValue(self.onSensor);
                        }

                        self._onSensor = self.onSensor;
                    }
                    break;
            }
        }.bind(this));
    }
    else {
        this.client.on('binaryState', function(state) {
            self.onState = state > 0;

            if (self.service) {
                if (self.onState !== self._onState) {
                    if (self.device.deviceType === Wemo.DEVICE_TYPE.Motion || self.device.deviceType === "urn:Belkin:device:NetCamSensor:1") {
                        self.updateMotionDetected();
                    }
                    else {
                        self.log('%s binaryState: %s', self.accessory.displayName, self.onState ? "on" : "off");
                        self.service.getCharacteristic(Characteristic.On).setValue(self.onState);

                        if(self.onState === false && self.device.deviceType === Wemo.DEVICE_TYPE.Insight) {
                            self.inUse = false;
                            self.updateInUse();

                            self.powerUsage = 0;
                            self.updatePowerUsage();
                        }
                    }
                }

                self._onState = self.onState;
            }
        }.bind(this));
    }

    if (device.deviceType === Wemo.DEVICE_TYPE.Insight) {
        this.client.on('insightParams', function(state, power, data){
            self.inUse = (state == 1);
            self.powerUsage = Math.round(power / 1000);

            // not currently returned by wemo-client
            if (data.TodayPowerConsumed !== undefined) {
                self.totalUsage = Math.round(data.TodayPowerConsumed / 10000 * 6) / 100;
            }

            if (self.service) {
                self.updateInUse();
                self.updatePowerUsage();
            }
        }.bind(this));
    }
}

WemoAccessory.prototype.getService = function() {
    var service = getServiceType(this.device.deviceType);

    if (service === undefined) {
        return;
    }

    return this.accessory.getService(service);
}

WemoAccessory.prototype.setOn = function (value, cb) {
    if (this.onState !== value) {  //remove redundent calls to setBinaryState when requested state is already achieved
        //this.log("setOn: %s to %s", this.accessory.displayName, value > 0 ? "on" : "off");
        this.client.setBinaryState(value ? 1 : 0, function (err){
            if(!err) {
                this.log("setOn: %s to %s", this.accessory.displayName, value > 0 ? "on" : "off");
                this.onState = value;
                if (cb) {
                    cb(null);
                }
            }
            else {
                this.log("setOn: FAILED setting %s to %s. Error: %s", this.accessory.displayName, value > 0 ? "on" : "off", err.code);
                if (cb) {
                    cb(new Error(err));
                }
            }
        }.bind(this));
    }
    else {
        if (cb) {
            cb(null);
        }
    }
}

WemoAccessory.prototype.updateInUse = function () {
    if (this.inUse !== this._inUse) {
        this.service.getCharacteristic(Characteristic.OutletInUse).setValue(this.inUse);
        this._inUse = this.inUse;
    }
}

WemoAccessory.prototype.updateMotionDetected = function() {
    var self = this;

    if (self.onState === true || self._onState === undefined) {
        if (self.motionTimer) {
            this.log("%s - no motion timer stopped", self.accessory.displayName);
            clearTimeout(self.motionTimer);
            self.motionTimer = null;
        }

        self.log("%s - notify binaryState change: %s", self.accessory.displayName, +self.onState);
        self.getService().getCharacteristic(Characteristic.MotionDetected).setValue(self.onState);
    }
    else {
        self.log("%s - no motion timer started [%d secs]", self.accessory.displayName, noMotionTimer);
        clearTimeout(self.motionTimer);
        self.motionTimer = setTimeout(function () {
            self.log("%s - no motion timer completed; notify binaryState change: 0", self.accessory.displayName);
            self.getService(self.accessory).getCharacteristic(Characteristic.MotionDetected).setValue(false);
            self._onState = false;
            self.motionTimer = null;
        }, noMotionTimer * 1000);
    }
}

WemoAccessory.prototype.updatePowerUsage = function () {
    if (this.powerUsage !== this._powerUsage) {
        this.service.getCharacteristic(Consumption).setValue(this.powerUsage);
        this._powerUsage = this.powerUsage;
    }

    if (this.totalUsage !== this._totalUsage) {
        this.service.getCharacteristic(TotalConsumption).setValue(this.totalUsage);
        this._totalUsage = this.totalUsage;
    }
}

function WemoLinkAccessory(log, accessory, link, device) {
    var self = this;

    this.accessory = accessory;
    this.link = link;
    this.device = device;
    this.log = log;
    this.client = wemo.client(link, log);
    this.onState = false;
    this.brightness = null;

    accessory.updateReachability(true);

    var service = this.accessory.getService(Service.Lightbulb)

    service
        .getCharacteristic(Characteristic.On)
        .on('set', this.setOnStatus.bind(this))
        .on('get', function(callback) {callback(null, self.onState)});

    service
        .getCharacteristic(Characteristic.Brightness)
        .on('set', this.setBrightness.bind(this))
        .on('get', function(callback) {callback(null, self.brightness)});

    this.accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Belkin WeMo")
        .setCharacteristic(Characteristic.SerialNumber, device.deviceId);

    // we can't depend on the capabilities returned from Belkin so we'll go ask expliciitly.
    this.getStatus(function (err) {
        self.onState = (self.device.capabilities['10006'].substr(0,1) === '1') ? true : false ;
        self.log("%s (bulb) reported as %s", self.accessory.displayName, self.onState ? "on" : "off");
        self.brightness = Math.round(self.device.capabilities['10008'].split(':').shift() / 255 * 100 );
        self.log("%s (bulb) reported as at %s%% brightness", self.accessory.displayName, self.brightness);
    });

    // register eventhandler
    this.client.on('statusChange', function(deviceId, capabilityId, value) {
        self.statusChange(deviceId, capabilityId, value);
    });
}

WemoAccessory.prototype.getStatus = function (cb) {
    // this function is called on initialisation of a Bulbs because we can't rely on Belkin's
    // capabilities structure on initialisation so we'll explicity retrieve it here.
    var self = this;

    this.client.getDeviceStatus(this.enddevice.deviceId, function (err, capabilities) {
        if(err) {
            if(cb) {cb("unknown error getting device status (getStatus)", capabilities)}
        }
        else {
            if (!capabilities['10006'].length) { // we've get no data in the capabilities array, so it's off
                self.log("%s appears to be off, i.e. at the power!",self.name);
            }
            else {
                //self.log("getStatus: %s is ", self.name, capabilities);
                self._capabilities = capabilities;
            }

            if (cb) {
                cb(null)
            }
        }
    });
}

WemoLinkAccessory.prototype.setBrightness = function (value, cb) {
    if (this.brightness !== value) { // we have nothing to do so lets leave it at that.
        this.client.setDeviceStatus(this.device.deviceId, 10008, value*255/100 );
        this.log("setBrightness: %s to %s%%", this.accessory.displayName, value);
        this.brightness = value;
    }

    if (cb) {
        cb(null);
    }
}

WemoLinkAccessory.prototype.setOnStatus = function (value, cb) {
    debug("this.Onstate currently %s, value is %s", this.onState, value );

    if(this.onState !== value) { // if we have nothing to do so lets leave it at that.
        this.onState = value;
        debug("this.Onstate now: %s", this.onState);
        this.log("setOnStatus: %s to %s", this.accessory.displayName, value > 0 ? "on" : "off");
        this.client.setDeviceStatus(this.device.deviceId, 10006, (value ? 1 : 0));
    }

    if (cb) {
        cb(null);
    }
}

WemoLinkAccessory.prototype.statusChange = function(deviceId, capabilityId, value) {
        // We recieve this notification if the wemo's are changed by Homekit (i.e us) or
        // some other trigger (i.e. any of the pethora of wemo apps).
        // We want to update homekit with these changes,
        // to do that we need to use setValue which triggers another call back to here which
        // we need to ignore - much of this function deals with the idiosyncrasies around this issue.

    if (this.device.deviceId !== deviceId){
        // we get called for every bulb on the link so lets get out of here if the call is for a differnt bulb
        this.log('statusChange Ignored (device): ', this.device.deviceId, deviceId, capabilityId, value);
        return;
    }

    if (this.device.capabilities[capabilityId] === value) {
        // nothing's changed - lets get out of here to stop an endless loop as
        // this callback was probably triggered by us updating HomeKit
        this.log('statusChange Ignored (capability): ', deviceId, capabilityId, value);
        return;
    }

    this.log('statusChange processing: ', deviceId, capabilityId, value);

    // update our internal array with newly passed value.
    this.device.capabilities[capabilityId] = value;

    switch(capabilityId) {
        case '10008': // this is a brightness change
            // update our convenience variable ASAP to minimise race condition possibiities
            var newbrightness = Math.round(this.device.capabilities['10008'].split(':').shift() / 255 * 100 );

            // changing wemo bulb brightness always turns them on so lets reflect this locally and in homekit.
            // do we really need this or do we get both status change messages from wemo?
            if (!this.onState){ // if off
                this.log('Update homekit onState: %s is %s', this.accessory.displayName, true);
                this.device.capabilities['10006'] = '1';
                this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).setValue(true);
            }

            // call setValue to update HomeKit and iOS (this generates another statusChange that will get ignored)
            this.log('Update homekit brightness: %s is %s', this.accessory.displayName, newbrightness);
            this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).setValue(newbrightness);
            break;
        case '10006': // on/off/etc
            // reflect change of onState from potentially and external change (from Wemo App for instance)
            var newState = (this.device.capabilities['10006'].substr(0,1) === '1') ? true : false;
            // similarly we need to update iOS with this change - which will trigger another state shange which we'll ignore
            this.log('Update homekit onState: %s is %s', this.accessory.displayName, newState);
            this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).setValue(newState);
            break;
        default:
            console.log("This capability (%s) not implemented", capabilityId);
    }
}

function getServiceType(deviceType) {
    var service;

    switch(deviceType) {
        case Wemo.DEVICE_TYPE.Insight:
        case Wemo.DEVICE_TYPE.Maker:
        case Wemo.DEVICE_TYPE.Switch:
        case "urn:Belkin:device:lightswitch:1":
            service = Service.Switch;
            break;
        case Wemo.DEVICE_TYPE.Motion:
        case "urn:Belkin:device:NetCamSensor:1":
            service = Service.MotionSensor;
            break;
        default:
            this.log("Not Supported");
    }

    return service;
}
