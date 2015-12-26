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

	this.id = device.deviceId;
	this.device = device;
	this.log = log;
	this._client = wemo.client(device);	

	if(device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
		this.name = enddevice.friendlyName;
		this.enddevice = enddevice;
		this.brightness = null;
		this._internalState = enddevice.internalState;

		// set onState for convenience
		this.onState = (this._internalState['10006'].substr(0,1) === '1') ? true : false ;
		this.log("%s is %s", this.name, this.onState, this._internalState['10006'].substr(0,1));

		// set brightness for convenience.
		this.brightness = Math.round(this._internalState['10008'].split(':').shift() / 255 * 100 );
		this.log("%s is %s bright", this.name, this.brightness);

		// register eventhandler
		this._client.on('statusChange', function(deviceId, capabilityId, value) {
			self._statusChange(deviceId, capabilityId, value);
		});
	} else {
		this.name = device.friendlyName;

		// set onState for convenience
		this.onState = device.binaryState > 0 ? true : false ;
		this.log("%s is %s", this.name, this.onState);


		// register eventhandler
		var timer = null;

		this._client.on('binaryState', function(state){
			self.log('%s binaryState: %s', this.name, state);
			self.onState = state > 0 ? true : false ;

			if (self.characteristic) {
				if (self.onState != self.oldState) {
					if (self.device.deviceType == Wemo.DEVICE_TYPE.Motion) {
						if (self.onState == true || self.oldState == undefined) {
							if (timer != null) {
								self.log("%s - no motion timer stopped", self.name);
								clearTimeout(timer);
								timer = null;
							}

							self.log("%s - notify binaryState change: %s", self.name, +self.onState);
							self.characteristic.setValue(self.onState);
						}
						else {
							self.log("%s - no motion timer started [%d secs]", self.name, noMotionTimer);
							clearTimeout(timer);
							timer = setTimeout(function () {
								self.log("%s - no motion timer completed; notify binaryState change: 0", self.name);
								self.characteristic.setValue(false);
								self.oldState = false;
								timer = null;
							}, noMotionTimer * 1000);
						}
					}
					else {
						self.characteristic.setValue(self.onState);
					}

					self.oldState = self.onState;
				}
			}
		}.bind(this));
	}
}

WemoAccessory.prototype._statusChange = function(deviceId, capabilityId, value) {
	this.log('statusChange: %s', deviceId, capabilityId, value);
	this._internalState[capabilityId] = value;

	if (capabilityId ==='10008') {
		this.brightness = Math.round(this._internalState['10008'].split(':').shift() / 255 * 100 );
		this._internalState['10006'] = '1';	 //changing wemo bulb brightness always turns them on so lets reflect this!
	}

	this.onState = (this._internalState['10006'].substr(0,1) === '1') ? true : false;
}

WemoAccessory.prototype.getServices = function () {
	var services = [];
	// set up the accessory information - not sure how mandatory any of this is.
	var service = new Service.AccessoryInformation();
	service.setCharacteristic(Characteristic.Name, this.name).setCharacteristic(Characteristic.Manufacturer, "WeMo");

	if (this.device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
		// todo - complete this information
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
			service = new Service.Lightbulb(this.name);

			service.getCharacteristic(Characteristic.On).on('set', this.setOnStatus.bind(this)).on('get', this.getOnStatus.bind(this));
			service.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this)).on('get', this.getBrightness.bind(this));

			services.push(service);
			break;
		case Wemo.DEVICE_TYPE.Insight:
		case Wemo.DEVICE_TYPE.Switch:
		case "urn:Belkin:device:lightswitch:1":
			service = new Service.Switch(this.name);

			this.characteristic = service.getCharacteristic(Characteristic.On)
			this.characteristic.on('set', this.setOn.bind(this)).on('get', this.getOn.bind(this));

			services.push(service);
			break;
		case Wemo.DEVICE_TYPE.Motion:
			service = new Service.MotionSensor(this.name);

			this.characteristic = service.getCharacteristic(Characteristic.MotionDetected)
			this.characteristic.on('get', this.getOn.bind(this));

			services.push(service);
			break;
		default:
			console.log("Not implemented");
	}
	//	this.log("Services for %s: ", this.name, services);
	return services;
};

WemoAccessory.prototype.setOn = function (value, cb) {
// 	var client = wemo.client(this.device);
	this.log("setOn: % to %s", this.name, value);
	this._client.setBinaryState(value ? 1 : 0);
	this.onState = value;
	if (cb) cb(null);

}

WemoAccessory.prototype.getOn = function (cb) {
	this.log("getOn: %s is %s ", this.name, this.onState);
	if (cb) cb(null, this.onState);
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
