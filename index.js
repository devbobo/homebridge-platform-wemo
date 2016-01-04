/* jshint node: true */
// Wemo Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// Remember to add platform to config.json. Example:
// "platforms": [
//		{
//			"platform": "BelkinWeMo",
//			"name": "Belkin WeMo",
//			"expected_accessories": "", stop looking for wemo accessories after this many found (excluding Wemo Link(s))
//			"timeout": "" //defaults to 10 seconds that we look for accessories.
//			"no_motion_timer": 60 // optional: [WeMo Motion only] a timer (in seconds) which is started no motion is detected, defaults to 60
//		}
// ],
"use strict";

var Service, Characteristic, Accessory, uuid;
var Wemo = require('wemo-client');
var wemo = new Wemo();

var noMotionTimer;

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;
	uuid = homebridge.hap.uuid;
	homebridge.registerPlatform("homebridge-platform-wemo", "BelkinWeMo", WemoPlatform);
};

function WemoPlatform(log, config) {
	this.log = log;
	this.log("Wemo Platform Plugin Loaded ");
	this.expectedAccessories = config.expected_accessories || 0 ; // default to false if not specficied
	this.timeout = config.timeout || 10; // default to 10 seconds if not specified

	noMotionTimer = config.no_motion_timer || 60;
}

WemoPlatform.prototype = {
	accessories: function (callback) {
		this.log("Fetching the Wemo Accessories, expecting %s and will wait %s seconds to find them.", 
			this.expectedAccessories ? this.expectedAccessories : "an unknown number" , this.timeout);
		var foundAccessories = [];
		var self = this;
		wemo.discover(function (device) {
			self.log("Found: %s, type: %s", device.friendlyName, device.deviceType.split(":")[3]);
			if (device.deviceType === Wemo.DEVICE_TYPE.Bridge) { // a wemolink bridge - find bulbs
				var client = this.client(device);
				client.getEndDevices(function (err, enddevices) {
					// this calls us back with an array of enddevices (bulbs)
					for (var i = 0, tot = enddevices.length; i < tot; i++) {
						self.log("Found endDevice: %s, id: %s", enddevices[i].friendlyName, enddevices[i].deviceId);
						var accessory = new WemoAccessory(self.log, device, enddevices[i]);
						foundAccessories.push(accessory);
						self.log("Discovered %s accessories of %s ", 
									foundAccessories.length, 
									self.expectedAccessories ? self.expectedAccessories : "an unspecified number of accessories")			
						if (foundAccessories.length == self.expectedAccessories){
							if (timer) {clearTimeout(timer);}
							callback(foundAccessories);
						}
					}
				});
			} else if (device.deviceType !== Wemo.DEVICE_TYPE.Maker) {
				var accessory = new WemoAccessory(self.log, device, null);
				foundAccessories.push(accessory);
				self.log("Discovered %s accessories of %s ", 
							foundAccessories.length, 
							self.expectedAccessories ? self.expectedAccessories : "an unspecified number of accessories");
				if (foundAccessories.length == self.expectedAccessories)
					{
					self.log("Woohoo!!! all %s accessories found.", self.expectedAccessories );
					if (timer) {clearTimeout(timer);} // if setTimeout got called already cancel it.
					callback(foundAccessories);
					}
				}
		});

		// we'll wait here for the accessories to be found unless the specified number of 
		// accessories has already been found in which case the timeout is cancelled!!

		var timer = setTimeout(function () {
			if(self.expectedAccessories) { 
				self.log("We have timed out and only discovered %s of the specified %s devices - try restarting homebridge or increasing timeout in config.json", 
					foundAccessories.length, self.expectedAccessories); 
					}
			callback(foundAccessories);
		}, self.timeout * 1000);
	},
};

function WemoAccessory(log, device, enddevice) {
	var self = this;

	this.device = device;
	this.log = log;
	this._client = wemo.client(device);	

	if(device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
		this.id = device.deviceId;
		this.name = enddevice.friendlyName;
		this.enddevice = enddevice;
		this.brightness = null;
		this._capabilities = enddevice.capabilities;

		// set onState for convenience from capabilities 
		// this does not however appear to be very reliable but thats an Belkin issue
		this.onState = (this._capabilities['10006'].substr(0,1) === '1') ? true : false ;
		this.log("%s is %s", this.name, this.onState);

		var self = this;
		
		// set brightness for convenience.
		// this does not however appear to be very reliable but thats an Belkin issue
		this.brightness = Math.round(this._capabilities['10008'].split(':').shift() / 255 * 100 );
		this.log("%s is %s bright", this.name, this.brightness);

		// register eventhandler
		this._client.on('statusChange', function(deviceId, capabilityId, value) {
			self._statusChange(deviceId, capabilityId, value);
		});
	} else {
		this.id = device.macAddress;
		this.name = device.friendlyName;

		// set onState for convenience
		this.onState = device.binaryState > 0 ? true : false ;
		this.log("%s is %s", this.name, this.onState);

		// register eventhandler
		var timer = null;

		this._client.on('binaryState', function(state){
			self.log('%s binaryState: %s', this.name, state);
			self.onState = state > 0 ? true : false ;

			if (self.service) {
				if (self.onState != self._onState) {
					if (self.device.deviceType == Wemo.DEVICE_TYPE.Motion || self.device.deviceType == "urn:Belkin:device:NetCamSensor:1") {
						if (self.onState == true || self._onState == undefined) {
							if (timer != null) {
								self.log("%s - no motion timer stopped", self.name);
								clearTimeout(timer);
								timer = null;
							}

							self.log("%s - notify binaryState change: %s", self.name, +self.onState);
							self.service.getCharacteristic(Characteristic.MotionDetected).setValue(self.onState);
						}
						else {
							self.log("%s - no motion timer started [%d secs]", self.name, noMotionTimer);
							clearTimeout(timer);
							timer = setTimeout(function () {
								self.log("%s - no motion timer completed; notify binaryState change: 0", self.name);
								self.service.getCharacteristic(Characteristic.MotionDetected).setValue(false);
								self._onState = false;
								timer = null;
							}, noMotionTimer * 1000);
						}
					}
					else {
						self.service.getCharacteristic(Characteristic.On).setValue(self.onState);
					}

					self._onState = self.onState;
				}
			}
		}.bind(this));

		if(device.deviceType === Wemo.DEVICE_TYPE.Insight) {
			this._client.on('insightParams', function(state){
				//self.log('%s inUse: %s', this.name, state);
				self.inUse = state == 1 ? true : false ;

				if (self.service) {
					if (self.inUse != self._inUse) {
						self.service.getCharacteristic(Characteristic.OutletInUse).setValue(self.inUse);
						self._inUse = self.inUse;
					}
				}
			}.bind(this));
		}
	}
}

WemoAccessory.prototype._statusChange = function(deviceId, capabilityId, value) {
	this.log('statusChange: %s', deviceId, capabilityId, value);
	this._capabilities[capabilityId] = value;

	if (capabilityId ==='10008') {
		this.brightness = Math.round(this._capabilities['10008'].split(':').shift() / 255 * 100 );
// 		this.setOnStatus('1');
		this._capabilities['10006'] = '1';	 //changing wemo bulb brightness always turns them on so lets reflect this!
	}

	this.onState = (this._capabilities['10006'].substr(0,1) === '1') ? true : false;
}

WemoAccessory.prototype.getServices = function () {
	var services = [];
	// set up the accessory information - not sure how mandatory any of this is.
	var service = new Service.AccessoryInformation();
	service.setCharacteristic(Characteristic.Name, this.name).setCharacteristic(Characteristic.Manufacturer, "WeMo");

	if (this.device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
		// todo - complete this information - if it was available.... which unfortunately it isn't 
/*
		service
            .setCharacteristic(Characteristic.Model, this.enddevice.modelName)
            .setCharacteristic(Characteristic.SerialNumber, this.enddevice.serialNumber)
            .setCharacteristic(Characteristic.FirmwareRevision, this.enddevice.firmwareVersion)
            .setCharacteristic(Characteristic.HardwareRevision, this.enddevice.modelNumber);
*/
	}
	else {
		service
			.setCharacteristic(Characteristic.Model, this.device.modelName)
			.setCharacteristic(Characteristic.SerialNumber, this.device.serialNumber)
			.setCharacteristic(Characteristic.FirmwareRevision, this.device.firmwareVersion)
			.setCharacteristic(Characteristic.HardwareRevision, this.device.modelNumber);
	}

	services.push(service);

	switch(this.device.deviceType) {
		case Wemo.DEVICE_TYPE.Bridge:
			this.service = new Service.Lightbulb(this.name);

			this.service.getCharacteristic(Characteristic.On).on('set', this.setOnStatus.bind(this)).on('get', this.getOnStatus.bind(this));
			this.service.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this)).on('get', this.getBrightness.bind(this));

			services.push(this.service);
			break;
		case Wemo.DEVICE_TYPE.Insight:
			this.service = new Service.Switch(this.name);

			this.service.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this)).on('get', this.getOn.bind(this));
			this.service.addCharacteristic(Characteristic.OutletInUse).on('get', this.getInUse.bind(this));

			services.push(this.service);
			break;
		case Wemo.DEVICE_TYPE.Switch:
		case "urn:Belkin:device:lightswitch:1":
			this.service = new Service.Switch(this.name);

			this.service.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this)).on('get', this.getOn.bind(this));

			services.push(this.service);
			break;
		case Wemo.DEVICE_TYPE.Motion:
		case "urn:Belkin:device:NetCamSensor:1":
			this.service = new Service.MotionSensor(this.name);

			this.service.getCharacteristic(Characteristic.MotionDetected).on('get', this.getOn.bind(this));

			services.push(this.service);
			break;
		default:
			console.log("Not implemented");
	}
	//	this.log("Services for %s: ", this.name, services);
	return services;
};

WemoAccessory.prototype.setOn = function (value, cb) {
// 	var client = wemo.client(this.device);
	if (this.onState != value) {  //remove redundent calls to setBinaryState when requested state is already achieved
		this.log("setOn: %s to %s", this.name, value);
		this._client.setBinaryState(value ? 1 : 0);
		this.onState = value;
		}
	if (cb) cb(null);
}

WemoAccessory.prototype.getOn = function (cb) {
	this.log("getOn: %s is %s ", this.name, this.onState);
	if (cb) cb(null, this.onState);
}

WemoAccessory.prototype.getInUse = function (cb) {
	this.log("getInUse: %s is %s ", this.name, this.inUse);
	if (cb) cb(null, this.inUse);
}

WemoAccessory.prototype.setOnStatus = function (value, cb) {
// 	var client = wemo.client(this.device);
	this._client.setDeviceStatus(this.enddevice.deviceId, 10006, (value ? 1 : 0));
	this.log("setOnStatus: %s to %s", this.name, value);
	if (cb) cb(null);
}

WemoAccessory.prototype.getOnStatus = function (cb) {
	this.log("getOnStatus: %s is %s", this.name, this.onState)
	if(cb) cb(null, this.onState);
}

WemoAccessory.prototype.setBrightness = function (value, cb) {
// 	var client = wemo.client(this.device);
	this._client.setDeviceStatus(this.enddevice.deviceId, 10008, value*255/100 );
	this.log("setBrightness: %s to %s\%", this.name, value);
	if (cb) cb(null);
}

WemoAccessory.prototype.getBrightness = function (cb) {
	this.log("getBrightness: %s is %s", this.name, this.brightness)
	if(cb) cb(null, this.brightness);
}
