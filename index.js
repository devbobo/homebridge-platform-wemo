/* jshint node: true */
// Wemo Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "BelkinWeMo",
//         "name": "Belkin WeMo",
//			"expected_accessories": "", stop looking for wemo accessories after this many found (excluding Wemo Link(s))
//			"timeout": "" //defaults to 10 seconds that we look for accessories.
//     }
// ],
"use strict";

var Service, Characteristic, Accessory, uuid;
var Wemo = require('wemo-client');
var wemo = new Wemo();

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
}
WemoPlatform.prototype = {
	accessories: function (callback) {
		this.log("Fetching the Wemo Accessories, expecting %s and will wait %s seconds to find them.", 
			this.expectedAccessories ? this.expectedAccessories : "an unknown number" , this.timeout);
		var foundAccessories = [];
		var self = this;
		wemo.discover(function (device) {
			self.log("Found: %s", device.friendlyName);
			if (device.deviceType === Wemo.DEVICE_TYPE.Bridge) { // a wemolink bridge - find bulbs
				var client = this.client(device);
				client.getEndDevices(function (err, enddevices) {
					// this calls us back with an array of enddevices (bulbs)
					for (var i = 0, tot = enddevices.length; i < tot; i++) {
						self.log("Found endDevice: %s, id: %s", enddevices[i].friendlyName, enddevices[i].deviceId);
						var accessory = new WemoAccessory(self.log, device, enddevices[i]);
						foundAccessories.push(accessory);
						self.log("Discovered %s accessories of %s ", foundAccessories.length, self.expectedAccessories ? self.expectedAccessories : "an unspecified number of accessories")			
						if (foundAccessories.length == self.expectedAccessories){
							if (timer) {clearTimeout(timer);}
							callback(foundAccessories);
						}
					}
				});
			} else if (device.deviceType === Wemo.DEVICE_TYPE.Switch 
					|| device.deviceType === Wemo.DEVICE_TYPE.Insight) {
				var accessory = new WemoAccessory(self.log, device, null);
				foundAccessories.push(accessory);
				self.log("Discovered %s accessories of %s ", foundAccessories.length, self.expectedAccessories ? self.expectedAccessories : "an unspecified number of accessories")			
				if (foundAccessories.length == self.expectedAccessories){
					if (timer) {clearTimeout(timer);}
					callback(foundAccessories);
				}
			}
		});

		// we'll wait here for the accessories to be found unless the specified number of accessories has already been found in which case we'll never get here!!

		var timer = setTimeout(function () {
			if(self.expectedAccessories) { self.log("We have timed out and only discovered %s of the specified %s devices - try restarting homebridge or increasing timeout in config.json", 
				foundAccessories.length, self.expectedAccessories) }
			callback(foundAccessories);
		}, self.timeout * 1000);
	},
};


function WemoAccessory(log, device, enddevice) {
	this.id = device.deviceId;
	this.name = enddevice ? enddevice.friendlyName : device.friendlyName;
	this.device = device;
	this.enddevice = enddevice;  // this is used as a flag to determine a bulb or a switch at time i.e. null = switch.
	this.log = log;
	this._client = wemo.client(device);	
	this.brightness = null;
	this._internalState = enddevice ? enddevice.internalState : null;
	// set onState for convenience.	
	if(enddevice) {
		this.onState = (this._internalState['10006'].substr(0,1) === '1') ? true : false ;
		this.log("%s is %s", this.name, this.onState, this._internalState['10006'].substr(0,1));
	} else {
		this.onState = device.binaryState > 0 ? true : false ;
		this.log("%s is %s", this.name, this.onState);
	}
	
	// set brightness for convenience.
	if(enddevice) {
		this.brightness = Math.round(this._internalState['10008'].split(':').shift() / 255 * 100 );
		this.log("%s is %s bright", this.name, this.brightness);
		}

//	this.log(this.name , device, enddevice);

 	var self = this;
 	
	this._client.on('binaryState', function(state){
		if (!self.enddevice) { // we seem to get a spurious binaryState on lights - ignore them!
			self.log('%s binaryState: %s', this.name, state);
	    	self.onState = state > 0 ? true : false ;
	    	}
  		}.bind(this));
  		
 
  	this._client.on('statusChange', function(deviceId, capabilityId, value) {
// 	    if (deviceId === self.deviceId) {
//	   	  self.log('statusChange: %s', self.name, self, deviceId, capabilityId, value, this._internalState);
	      self._statusChange(deviceId, capabilityId, value);
// 	    	}
			});
}

WemoAccessory.prototype._statusChange = function(deviceId, capabilityId, value) {
   this.log('statusChange: %s', deviceId, capabilityId, value);
   this._internalState[capabilityId] = value;
   if (capabilityId ==='10008') {
	   this.brightness = Math.round(this._internalState['10008'].split(':').shift() / 255 * 100 );
	   this._internalState['10006'] = '1';  //changing wemo bulb brightness always turns them on so lets reflect this! 
	   }
	   
   this.onState = (this._internalState['10006'].substr(0,1) === '1') ? true : false;
}


WemoAccessory.prototype.getServices = function () {
	var services = [];
	// set up the accessory information - not sure how mandatory any of this is.
	// todo - complete this information
	var accessoryInformationService = new Service.AccessoryInformation();
	accessoryInformationService.setCharacteristic(Characteristic.Name, this.name).setCharacteristic(Characteristic.Manufacturer, "WeMo");
	services.push(accessoryInformationService);
	if (this.enddevice) { // we have a lightbulb
		var lightbulbService = new Service.Lightbulb(this.name);
		lightbulbService.getCharacteristic(Characteristic.On).on('set', this.setOnStatus.bind(this)).on('get', this.getOnStatus.bind(this));
		lightbulbService.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this)).on('get', this.getBrightness.bind(this));
		services.push(lightbulbService);
	} else { // everything else I have is a switch so that's it for now!
		var switchService = new Service.Switch(this.name);
		switchService.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this)).on('get', this.getOn.bind(this));
		services.push(switchService);
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
// 	var client = wemo.client(this.device);
/*
	var self = this;
	this._client.getDeviceStatus(this.enddevice.deviceId, function (err, state) {
		if(err) {
			if(cb) {cb("unknown error getting device status (OnStatus)")}
			}
		else {
			// convert string of capabilities and values to arrays.
			var capabilities = state.CapabilityID[0].split(',');
			var capabilityValues = state.CapabilityValue[0].split(',');
			// extract value if capability 10006 - onState
			var onState = capabilityValues[capabilities.indexOf('10006')];
			self.log("getOnStatus: %s is %s", self.name, onState);
			if (cb) {
				if (onState) {
					cb(null, (onState > 0 ? true : false));
				} else {
					cb("Currently offline");
				}
			}
		}
	});
*/
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
	
	
// 	var client = wemo.client(this.device);
/*
	var self = this;
	this._client.getDeviceStatus(this.enddevice.deviceId, function (err, state) {
		if(err) {
			if(cb) {cb("unknown error getting device status (Brightness)")}
			}
		else {
			var capabilities = state.CapabilityID[0].split(',');
			var capabilityValues = state.CapabilityValue[0].split(',');
			var brightness = Math.round(capabilityValues[capabilities.indexOf('10008')].split(':').shift() / 255 * 100);
			self.log("getBrightness: %s brightness %s\%", self.name, brightness);
			if (cb) {
				if (brightness) {
					cb(null, brightness);
				} else {
					cb("Currently offline")
				}
			}
		}
	});
*/
}