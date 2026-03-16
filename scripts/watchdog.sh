#!/bin/bash
# Flight Monitor watchdog — ensures pm2 and flight-monitor are running
# Run via crontab every 5 minutes

export PATH="/Users/samuelkemper/.nvm/versions/node/v24.4.1/bin:$PATH"
export HOME="/Users/samuelkemper"

# Check if pm2 daemon is running
if ! pm2 pid > /dev/null 2>&1 || [ "$(pm2 pid)" = "" ]; then
  pm2 resurrect 2>/dev/null
fi

# Check if flight-monitor is running
STATUS=$(pm2 jlist 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const a=JSON.parse(d);const p=a.find(x=>x.name==='flight-monitor');
    console.log(p?p.pm2_env.status:'missing')}catch{console.log('error')}
  })
")

if [ "$STATUS" != "online" ]; then
  echo "$(date): flight-monitor status=$STATUS — restarting" >> /Users/samuelkemper/Desktop/flight-monitor/logs/watchdog.log
  cd /Users/samuelkemper/Desktop/flight-monitor
  pm2 start ecosystem.config.cjs 2>/dev/null || pm2 restart flight-monitor 2>/dev/null
fi
