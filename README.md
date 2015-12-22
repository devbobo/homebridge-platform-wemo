# homebridge-platform-wemo

Belkin WeMo Platform plugin for the awesome  [Homebridge](https://github.com/nfarina/homebridge) project.

Currently supports
- Wemo Switch
- Wemo Insight Switch (on/off only)
- Wemo Bulb (via Wemo Link - on/off/brightness)

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-platform-wemo
3. Update your configuration file. See the sample below.

# Updating

Recently refactored to increase speed of operation and update on/off/brightness status more reliably.

1. npm update -g homebridge-platform-wemo

# Configuration

Configuration sample:

`expected_accessories` is the count of Wemo bulbs and switches you have - it is optional and if not specified the `timeout` value will be used to wait for the discovery process to conclude. 
`timeout` is specified in seconds and will default to 10 seconds.

 ```javascript
"platforms": [
        {
          "platform": "BelkinWeMo",
          "name": "WeMo Platform",
          "expected_accessories" : "x",
          "timeout" : "y"
        }   
    ]

```

The module will try and find all your WeMo Devices and make them available to HomeBridge / HomeKit / Siri.

# ToDo

The code was recently updated to increase the speed of status checking by persisting the WemoClient objects properly.

# Credits

Credit goes to
- Timon Reinhard for his awesome [Wemo Client](https://github.com/timonreinhard/wemo-client) module and advise 
- Andy Lindeman for the [homebridge-smartthings](https://github.com/alindeman/homebridge-smartthings) that this is work is based on.

# License

Published under the MIT License.
