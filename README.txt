AGENT EVALUATION APP

FILES
- index.html          Main application screen
- style.css           Visual design
- app.js              Application logic
- data/data.json      JSON structure/template
- scripts/start-app.ps1
- scripts/backup-data.ps1
- scripts/servicenow-lookup.ps1

HOW TO OPEN
Option 1:
Double-click index.html.

Option 2:
Right-click scripts/start-app.ps1 and run with PowerShell.
Then open:
http://localhost:8080

IMPORTANT
The app saves data in the browser localStorage.
Use Export JSON regularly from the Database screen.

SERVICENOW
Go to Settings inside the app and replace YOUR_INSTANCE with your real ServiceNow instance name.
Example:
mycompany
not:
https://mycompany.service-now.com

BACKUP
Run:
scripts/backup-data.ps1

NOTE
data/data.json is a template and backup structure.
The live app stores data in the browser localStorage unless you export/import JSON.
