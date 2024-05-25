# Courier 🐴

**Courier** is an application to track your parcels using ParcelsApp API.  
Written in TypeScript.
---------------
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

You'll be asked to enter your tracking number and destination country. You ***SHOULD NOT*** skip it for first time, otherwise app will crash!  

On every next run you'll be asked to do the same, if you wish not to, just press enter *twice* and it's gonna use same tracking number and country. 

#### Note, that you also can change just one variable, leaving another one empty.  
-------------------
# Usage 🧠

Open tray, click on icon (courier from Dota 2) and you're good to go!  

To exit, click first entry named **Close tracker**, to copy tracking number **click on it**.  

------------------
# Known bugs 🐞

Sometimes, after changing tracking number while already having different saved number, app will crash on start. **Workaround**: start app using `npm run pkg` multiple times if it keeps crashing.