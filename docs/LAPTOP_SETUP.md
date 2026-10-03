# Run Dawa on your laptop (for testing)

These steps install Dawa with a demo pharmacy ("Upendo Pharmacy") so you can try everything.
It takes about 20 minutes the first time. You only do Part A once.

You need an internet connection and about 2 GB of free disk space.

---

## Part A — Install the tools (once)

### Windows

1. **Node.js** — go to <https://nodejs.org>, download **Node.js 22 (LTS)** "Windows Installer (.msi)",
   run it and click *Next* through the installer (keep the default options).
2. **PostgreSQL** — go to <https://www.postgresql.org/download/windows/>, click *Download the installer*,
   choose **version 16** for Windows x86-64 and run it.
   * Keep the default components (PostgreSQL Server, pgAdmin, Command Line Tools).
   * When it asks for a **password for the "postgres" user**, choose one and **write it down**.
   * Keep port **5432**. Untick "Stack Builder" at the end.
3. **Git** (to download the code) — go to <https://git-scm.com/download/win>, install with the default options.

### Mac

1. Install Homebrew if you do not have it: open **Terminal** and paste the command shown on <https://brew.sh>.
2. In Terminal:
   ```bash
   brew install node@22 postgresql@16 git
   brew link --force node@22
   brew services start postgresql@16
   ```

**Check:** open a new Command Prompt (Windows: Start → type `cmd`) or Terminal (Mac) and run
`node -v` — it should print `v22.…`.

---

## Part B — Create the database (once)

### Windows

1. Start menu → **SQL Shell (psql)**.
2. Press **Enter** four times (Server, Database, Port, Username keep their defaults), then type the
   **postgres password** from Part A (nothing appears while you type — that is normal) and press Enter.
3. Type these three lines, pressing Enter after each (you can change `DawaTest2026` to your own password):
   ```sql
   CREATE USER dawa WITH PASSWORD 'DawaTest2026';
   CREATE DATABASE dawa OWNER dawa;
   \q
   ```

### Mac

In Terminal:
```bash
psql postgres -c "CREATE USER dawa WITH PASSWORD 'DawaTest2026';"
psql postgres -c "CREATE DATABASE dawa OWNER dawa;"
```

---

## Part C — Download and set up Dawa (once)

Use **Command Prompt** on Windows (not PowerShell) or **Terminal** on Mac.

1. Go to the folder where you want Dawa (for example your Documents) and download it:
   ```bash
   cd Documents
   git clone https://github.com/Shengcarter/dawa-pharmacy.git
   cd dawa-pharmacy
   ```
   (If Git asks you to sign in, sign in with your GitHub account. Alternatively, on the GitHub page click
   **Code → Download ZIP**, unzip it into Documents, and `cd Documents\dawa-pharmacy-main`.)

2. Install the program's parts (takes 1–3 minutes):
   ```bash
   npm install
   ```

3. Create the settings file:
   * Windows: `copy server\.env.example server\.env` then `notepad server\.env`
   * Mac: `cp server/.env.example server/.env` then `open -e server/.env`

4. In the file that opens, change these two lines and **save**:
   ```
   DATABASE_URL=postgres://dawa:DawaTest2026@localhost:5432/dawa
   JWT_ACCESS_SECRET=paste-the-random-text-from-the-next-step-here
   ```
   To get the random text for `JWT_ACCESS_SECRET`, run this in the Command Prompt/Terminal and copy the
   line it prints:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   (Use your own database password in `DATABASE_URL` if you chose a different one in Part B.)

   **Windows only, optional:** for the *Back up now* button to work, also set
   `PG_DUMP_PATH=C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`

5. Load the demo pharmacy (takes about a minute):
   ```bash
   npm run seed -w server -- --reset
   ```
   It finishes with a line starting `Done: … sales, … prescriptions …`.

---

## Part D — Start Dawa (every time you want to use it)

1. Open Command Prompt / Terminal, go to the folder and start:
   ```bash
   cd Documents/dawa-pharmacy
   npm run dev
   ```
   Wait until you see `Local: http://localhost:5173/` and `Dawa API listening`.
   **Leave this window open** while you use Dawa.
2. Open **Chrome or Edge** and go to **<http://localhost:5173>**.
3. Sign in with any demo account — the password for all of them is **`Upendo@2026`**:

   | Email | Role | Try |
   | --- | --- | --- |
   | `grace@upendopharmacy.co.tz` | Owner / Manager | everything: dashboard, stock, reports, settings, staff |
   | `halima@upendopharmacy.co.tz` | Pharmacist | prescriptions and dispensing at the till |
   | `rehema@upendopharmacy.co.tz` | Cashier | the till (point of sale) |
   | `emmanuel@upendopharmacy.co.tz` | Inventory officer | purchase orders, receiving stock, expiry |
   | `fatuma@upendopharmacy.co.tz` | Accountant | payments, expenses, insurance claims, profit & loss |
   | `admin@upendopharmacy.co.tz` | Super Admin | roles and permissions |

4. To stop Dawa: go back to the Command Prompt/Terminal window and press **Ctrl + C**.

To **start again from a clean demo** at any time (this erases everything you entered): stop Dawa, run
`npm run seed -w server -- --reset`, then `npm run dev`.

---

## What to try

* **Till** (Rehema): search "paracetamol", sell a strip and a "pack of 10", pay with cash; scan a barcode if you
  have a scanner; print or WhatsApp the receipt.
* **Quantity price**: put 30 strips of Paracetamol in the cart — the price drops to 650.
* **Prescription + insurance** (Halima): *Prescriptions* → open a pending one → *Dispense at till*. For an insured
  patient (Godfrey — Jubilee Health, or Mariam — NHIF) the till shows what the insurer pays and what the patient pays.
* **Insurance claims** (Fatuma): *Insurance → Claims* → tick claims → *Submit* → open one → *Record payment*.
* **Stock** (Emmanuel): *Purchasing → Purchase orders* → receive a delivery; *Inventory → Expiry tracking*.
* **Reports** (Grace): *Reports → Profit & loss*, *Sales*, *Inventory*.
* **Two-factor sign-in** (Grace): *Settings → System & backups* → turn on *Require two-factor authentication for
  administrators* → save → follow the set-up with an authenticator app on your phone (Google Authenticator,
  Microsoft Authenticator). Write down the recovery codes.

---

## If something goes wrong

| Problem | Fix |
| --- | --- |
| `node` is not recognised | Close and reopen Command Prompt after installing Node.js; restart the laptop if it persists. |
| `password authentication failed for user "dawa"` | The password in `DATABASE_URL` does not match Part B. Fix the `.env` line. |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. Windows: Start → *Services* → start "postgresql-x64-16". Mac: `brew services start postgresql@16`. |
| `JWT_ACCESS_SECRET must be at least 32 characters` | Paste the random text from Part C step 4 into `server/.env`. |
| Port 5173 or 4000 already in use | Another copy is running: close the other window, or restart the laptop. |
| PowerShell says scripts are disabled | Use **Command Prompt** instead of PowerShell. |
| Signed out after a while | Normal: sessions end after 30 minutes without activity (change it in *Settings → System*). |

If you are stuck, copy the exact message from the window and send it along with the step number.
