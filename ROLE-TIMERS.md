# Admin, VIP and Boss expiry

Owners and SWAG can choose **1–12 calendar months** or **Permanent** when assigning Admin, VIP or Boss through the Staff Role Console. New assignments default to Admin 1 month, VIP 6 months and Boss 12 months. Other roles do not receive expiry timers.

Use **Хугацаа өөрчлөх** on a member's staff card or profile to choose a new duration, make access permanent, or set a specific expiry date and time. The dialog previews the deadline in Ulaanbaatar time. Month selections count from the moment of saving and clamp to the last day of short months. A renewal preserves the original Staff since timestamp. Owners may also backfill a known historical start date; unknown dates are displayed as a dash.

The public card and profile show **STAFF SINCE** and **EXPIRES**, including the remaining days and expiry date. Permanent access is labelled explicitly. Expired roles disappear from the active roster and remain in an Owner/SWAG-only renewal list. Reopen an editor if another operator has changed that member's role or deadline.

Existing assignments migrate as permanent without invented start dates. Deployment alone does not place existing members on a new countdown. Choose a duration for each existing assignment when appropriate. Staff records, role times, clans and account links persist in Netlify Blobs.

Expiry is enforced by the server, independently of the browser clock. The authenticated role feed excludes expired assignments. The running bot normally removes Discord roles that this integration granted within its next successful refresh, usually within 60 seconds. If the website or Discord is unavailable, or the bot lacks permission to remove a role, it retries instead of discarding its grant record. Independently assigned Discord roles are preserved. Expiry does not disconnect the Discord account.

Payment verification remains manual; QPay automation is not configured. A timer can expire independently of payment-provider setup.
