# Courier 🐴

**Courier** is an application to track your parcels using ParcelsApp API.  
Written in TypeScript.

# Installation 🔧

```
git clone https://github.com/crtmitchn/courier.git
cd courier
```

After that, edit `.env` file and add your ParcelsApp API key. You can get it [there](https://parcelsapp.com/dashboard/#/admin/dashboard).

```
npm i
npm run pkg
```

KEEP IN MIND that you need to install `xclip` package on Linux in order to copy track number to clipboard, otherwise it'll crash!

You'll be asked to enter your tracking number and destination country. You **_SHOULD NOT_** skip it for first time, otherwise app will crash!

On every next run you'll be asked to do the same, if you wish not to, just press enter _twice_ and it's gonna use same tracking number and country.

#### Note, that you also can change just one variable, leaving another one empty.

# Usage 🧠

Open tray, click on icon (courier from Dota 2) and you're good to go!

To exit, click first entry named **Close tracker**, to copy tracking number **click on it**.
