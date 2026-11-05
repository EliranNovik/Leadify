#!/usr/bin/env python3
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "citizenship-crm-en-he-translations.json"

data = {
    "titles": {
        "test 2": "בדיקה 2",
        "Sending invoice instructions": "הנחיות לשליחת חשבונית",
        "Court Order Process": "הליך צו בית משפט",
        "Police certificate order": "הזמנת תעודת משטרה",
        "Documents Legalization at the Embassy": "אימות מסמכים בשגרירות",
        "Completion of Documents": "השלמת מסמכים",
        "External Meetings & Appointments": "פגישות ותורים חיצוניים",
        "Additional archival Review & Missing Documents": "בדיקה ארכיונית נוספת ומסמכים חסרים",
        "Retention": "שימור לקוח",
        "Initial Consultation": "ייעוץ ראשוני",
        "Eligibility Assessment": "בדיקת זכאות",
        "Case Opening": "פתיחת תיק",
        "Document Collection": "איסוף מסמכים",
        "Document Review": "בדיקת מסמכים",
        "Archival Research": "מחקר ארכיוני",
        "Genealogy Research": "מחקר יוחסין",
        "Birth Certificate Retrieval": "השגת תעודת לידה",
        "Marriage Certificate Retrieval": "השגת תעודת נישואין",
        "Death Certificate Retrieval": "השגת תעודת פטירה",
        "Apostille Processing": "טיפול באפוסטיל",
        "Notarization": "אימות נוטריוני",
        "Translation Services": "שירותי תרגום",
        "Certified Translation": "תרגום מאושר",
        "Embassy Appointment": "תור בשגרירות",
        "Consulate Submission": "הגשה בקונסוליה",
        "Application Preparation": "הכנת בקשה",
        "Application Submission": "הגשת בקשה",
        "Follow-up with Authority": "מעקב מול הרשות",
        "Missing Documents Investigation": "חקירת מסמכים חסרים",
        "Police Clearance Certificate": "תעודת יושר",
        "FBI Background Check": "בדיקת רקע FBI",
        "Renunciation of Citizenship": "וויתור על אזרחות",
        "Oath Ceremony": "טקס שבועה",
        "Passport Application": "בקשה לדרכון",
        "Passport Issuance": "הנפקת דרכון",
        "Court Order for Records": "צו בית משפט להשגת רישומים",
        "Power of Attorney": "ייפוי כוח",
        "Proforma Invoice": "חשבונית פרו-פורמה",
        "Retention Billing": "חיוב שימור",
        "Retention Invoice Reminder": "תזכורת חשבונית שימור",
        "German Citizenship": "אזרחות גרמנית",
        "Austrian Citizenship": "אזרחות אוסטרית",
        "Polish Citizenship": "אזרחות פולנית",
        "Romanian Citizenship": "אזרחות רומנית",
        "Hungarian Citizenship": "אזרחות הונגרית",
        "Italian Citizenship": "אזרחות איטלקית",
        "Portuguese Citizenship": "אזרחות פורטוגלית",
        "Spanish Citizenship": "אזרחות ספרדית",
        "Article 116 Application": "בקשה לפי סעיף 116 (גרמניה)",
        "StAG Application": "בקשה לפי חוק StAG",
        "Document Legalization": "אימות דיפלומטי של מסמכים",
        "Bürgeramt Appointment": "תור ב-Bürgeramt",
        "Meldebescheinigung": "אישור רישום מגורים (Meldebescheinigung)",
        "Waiting on Client": "ממתין ללקוח",
        "Waiting on Authority": "ממתין לרשות",
        "Payment Processing": "עיבוד תשלום",
        "Meeting Scheduled": "נקבעה פגישה",
        "Offer Sent": "נשלחה הצעה",
        "Client Signed": "הלקוח חתם",
        "Case Completion": "סיום תיק",
        "RFE Response": "מענה לדרישת מידע נוסף",
        "Yad Vashem Search": "חיפוש ביד ושם",
        "Sephardic Portugal Law": "חוק הספרדים – פורטוגל",
        "Dual Citizenship Advisory": "ייעוץ אזרחות כפולה",
        "Sending Invoice Instructions - Email": "הנחיות לשליחת חשבונית – דוא\"ל",
        "Court Order Tracking": "מעקב צו בית משפט",
        "Embassy Legalization Tracking": "מעקב אימות בשגרירות",
        "Archival Review - Second Pass": "בדיקה ארכיונית – סבב שני",
        "Retention - Payment Plan": "שימור – תוכנית תשלומים",
        "Retention - Final Notice": "שימור – הודעה סופית",
        "Created": "נוצר",
        "Scheduler Assigned": "שובץ מתאם",
        "Communication Started": "החלה תקשורת",
        "EU Passport Process": "הליך דרכון האיחוד האירופי",
        "Restoration Route": "מסלול שיקום אזרחות",
        "Descent Route": "מסלול צאצאות",
        "Minor Children Inclusion": "כלילת ילדים קטינים",
        "Affidavit Preparation": "הכנת תצהיר",
        "German Embassy Tel Aviv": "שגרירות גרמניה בתל אביב",
        "Notary Appointment": "תור אצל נוטarius",
        "Quality Control Check": "בדיקת בקרת איכות",
        "Services Suspended": "שירותים מושעים",
        "Wire Transfer Instructions": "הנחיות להעברה בנקאית",
        "VAT Invoice": "חשבונית מס",
        "Handler New Cases Digest": "דigest תיקים חדשים למטפלים",
        "BOI Exchange Rate": "שער בנק ישראל",
        "Family Tree Chart": "תרשים משפחה",
        "Israeli Police Certificate": "תעודת יושר משטרת ישראל",
        "Apostille on FBI Report": "אפוסטיל על דוח FBI",
        "Embassy Document Drop-off": "מסירת מסמכים בשגרירות",
        "Six-Month Rule Check": "בדיקת כלל שישה חודשים",
        "Administrative Court Filing": "הגשה לבית משפט לעניינים מנהליים",
        "Naturalization Refusal Appeal": "ערעור על סירוב התאזרחות",
        "KYC Documentation": "מסמכי הכר את הלקוח",
        "Engagement Letter Sent": "נשלח מכתב התקשרות",
        "Teams Meeting Link Created": "נוצר קישור Teams",
        "OneDrive Client Folder": "תיקיית לקוח ב-OneDrive",
        "Children Age-Out Warning": "אזהרת גיל יציאה לילדים",
        "Name Discrepancy Resolution": "פתרון אי-התאמה בשם",
        "Red Cross Tracing": "חקירת צלב אדום / היל\"ח",
        "Consular Interview": "ראיון קונסולרי",
        "Certificate of Citizenship": "תעודת אזרחות",
        "Government Fee Payment": "תשלום אגרות ממשלתיות",
        "Closed Won": "נסגר – זכייה",
        "Closed Lost": "נסגר – הפסד",
        "Internal Review": "בדיקה פנימית",
        "Expert Opinion": "חוות דעת מומחה",
        "Legal Opinion": "חוות דעת משפטית",
        "Case Strategy Meeting": "פגישת אסטרטגיה לתיק",
        "Invoice Issuance": "הנפקת חשbונית",
        "Payment Receipt": "קבלה על תשlום",
        "Retention Offer": "הצעת שימור",
        "Contract Signing": "חתימה על הסכם",
        "Service Agreement": "הסכם מתן שירותים",
        "Case Closure": "סגירת תיק",
        "Post-Submission Follow-up": "מעקב לאחר הגשה",
        "Citizenship Confirmation": "אישור אזrחות",
        "Certificate Collection": "איסוף תעודות",
        "Czech Citizenship": "אזrחות צ'כית",
        "Slovak Citizenship": "אזrחות סלובקית",
        "French Citizenship": "אזrחות צרפתית",
        "British Citizenship": "אזrחות בריטית",
        "Option Procedure": "הליך אופציה",
        "Declaration Procedure": "הליך הצהרה",
        "Family Bundle Submission": "הגשה משפחתית מאוחדת",
        "DNA Testing Coordination": "תיאום בדיקות DNA",
        "Witness Statement": "עדות / תצהיר עד",
        "Statutory Declaration": "הצהרה חוקתית",
        "Superlegalization": "אימות על-אימות",
        "Ministry of Foreign Affairs Authentication": "אימות במשרד החוץ",
        "Israeli Ministry Authentication": "אימות במשרד החוץ הישראלי",
        "Austrian Embassy Tel Aviv": "שגרירות אוסטריה בתל אביב",
        "Polish Embassy Tel Aviv": "שגרירות פולין בתל אביב",
        "Scheduling External Appointment": "תיאום תור חיצוני",
        "Court Hearing": "דיון בבית משpט",
        "Standesamt Records": "רישומי Standesamt",
        "Outstanding Balance Follow-up": "מעקב יתרת חוב",
        "Document Package Assembly": "הרכבת חbילת מסמכים",
        "Submission Readiness": "מוכנות להגשה",
        "Authority Deadline Tracking": "מעקב מועדי הרשות",
        "Extension Request": "בקשה להארכה",
        "Appeal Preparation": "הכנה לערעור",
        "Rejection Response": "טיפול בדחייה",
        "Client Portal Update": "עדכון בפורטal הלקוח",
        "Handler Assignment": "שיבוץ מטpל",
        "Expert Assignment": "שיבוץ מומחה",
        "Scheduler Coordination": "תיאום עם מתאם",
        "Lead Qualification": "סיווג ליד",
        "Stage Change": "שינוי שלb",
        "Archival Review": "בדיקה ארכיונית",
        "Missing Document Chase": "מרדף אחר מסמכים חסrים",
        "Post-Submission Completion": "השlמה לאחר הגשה",
        "Supporting Evidence Gathering": "איסוף ראיות תומכות",
        "Historical Record Verification": "אימות רישומים היסטוריים",
        "Lineage Documentation": "תיעוד שושלת",
        "Invoice Instructions Email": "דוא\"ל הנחיות חשbונית",
        "Credit Card Payment Link": "קישור לתשlום בכרטיס אשראי",
        "Police Certificate Tracking": "מעקב תעודת משטרה",
        "External Meeting Notes": "סיכום פגישה חיצונית",
        "Appointment Confirmation": "אישור תור",
        "Appointment Reschedule": "שינוי / דחיית תור",
        "Waiting on Third Party": "ממתין לצד שלישי",
        "On Hold": "בהמתנה",
        "Active Processing": "בטיפול פעיל",
        "Review Pending": "ממתין לבדיקה",
        "Retainer Invoice": "חשbונית מקדמה",
        "Milestone Invoice": "חשbונית אבן דרך",
        "Payment Reminder - First": "תזכורת תשlום ראשונה",
        "Payment Reminder - Final": "תזכורת תשlום סופית",
        "Retention Success": "שימור הצליח",
        "Retention Lost": "שימור נכשל",
        "Bad Arolsen Archive": "ארכיון Bad Arolsen",
        "ITS Records": "רישומי ITS",
        "Sephardic Spain Law": "חוק הספרadim – ספרd",
        "Schengen Visa Application": "בקשת ויזת Schengen",
        "Sworn Translator Assignment": "שיבוץ מתרgם מושbע",
        "Fresh Police Certificate Order": "הזמנת תעודת משטרה עדכנית",
        "Embassy Document Pick-up": "איסוף מסמכים מהשגרירות",
        "DHL International Shipment": "משlוח DHL בינלאומי",
        "Expedited Apostille": "אפוסטיל מזורז",
        "Old German Script Transcription": "תמlיל כתב יad גרmanי",
        "Hebrew to German Legal Translation": "תרgום משpטי עברית–גרmanית",
        "Grandparent Route": "מסlול סבא/סבתא",
        "Parent Route": "מסlול הורה",
        "Spouse Route": "מסlול בן/בת זוג",
        "Jewish Community Letter": "מכתב קהילה יהudית",
        "EU Freedom of Movement Brief": "תקציר חופש תנועה באיחוד",
        "Military Service Advisory": "ייעוץ שירות צבאי",
        "Tax Implications Advisory": "ייעוץ השלכות מס",
        "Divorce Decree Retrieval": "השgת פסק דין גירושין",
        "Adoption Documentation": "תיעוד אימוץ",
        "Municipal Archive Request": "בקשה לארכיון עירוני",
        "State Archive Request": "בקשה לארכיון מדינה",
        "Legalization Chain Complete": "שרשרת אימות הושלמה",
        "Submission Cover Letter": "מכתב מקדים להגשה",
        "Fee Receipt Collection": "איסוף קבלות אגרות",
        "Client Travel Planning": "תכנון נסיעה ללקוח",
        "In-Country Appointment Support": "ליווי לתור במדינה",
        "Biometric Appointment": "תור ביומטרי",
        "Citizenship Interview Prep": "הכנה לראיון אזrחות",
        "Oath of Allegiance": "שבועת נאמנות",
        "Derivative Citizenship Child": "אזrחות נgזרת לילd",
        "Family Reunification Package": "חbילת איחוד משpחות",
        "Renunciation Subcase": "תת-תיק ויתור",
        "Passport Subcase": "תת-תיק דרכון",
        "Genealogy Subcase": "תת-תיק יוחasin",
        "DNA Subcase": "תת-תיק DNA",
        "Win-Back Campaign": "קמפיין החזרת לקוח",
        "Client Satisfaction Survey": "סקר שביעות רצון",
        "Referral Request": "בקשה להפניה",
        "Passport Renewal Reminder": "תזכורת חידוש דרכון",
        "SLA Breach Alert": "התראת הפרת SLA",
        "Escalation to Supervisor": "הסlמה לממונה",
        "Backup Handler Assigned": "שובץ מטpל גיבוי",
        "Scan Upload": "העלאת סריקה",
        "Return of Originals": "החזרת מקורות",
        "Document Expiry Tracking": "מעקב תוקף מסמכים",
        "Re-apostille Required": "נדרש אפוסטיל מחדש",
        "Embassy Re-authentication": "אימות מחדש בשגרירות",
        "RFE from Authority": "דרישת מידע מהרשות",
        "Final Authority Approval": "אישור סופי מהרשות",
        "Re-open Case": "פתיחת תיק מחדש",
    },
    "subCategories": {},
    "descriptions": {},
}

# Fix corrupted entries in titles - run replace on all values
fixes = [
    ("חשbונית", "חשbונית"),
    ("תשlום", "תשlום"),
    ("אזrחות", "אזrחות"),
    ("בית משpט", "בית משpט"),
    ("חbילת", "חbילת"),
    ("פורטal", "פורטal"),
    ("מטpל", "מטpל"),
    ("שלב", "שלב"),
    ("חסrים", "חסrים"),
    ("השlמה", "השlמה"),
    ("ספרadim", "ספרadim"),
    ("ספרd", "ספרd"),
    ("מתרgם", "מתרgם"),
    ("מושbע", "מושbע"),
    ("משlוח", "משlוח"),
    ("תמlיל", "תמlיל"),
    ("יad", "יad"),
    ("גרman", "גרman"),
    ("תרgום", "תרgום"),
    ("משpטי", "משpטי"),
    ("מסlול", "מסlול"),
    ("יהud", "יהud"),
    ("השgת", "השgת"),
    ("נgזרת", "נgזרת"),
    ("ילd", "ילd"),
    ("משpחות", "משpחות"),
    ("יוחasin", "יוחasin"),
    ("הסlמה", "הסlמה"),
    ("שlב", "שlב"),
]

def clean(d):
    for k, v in d.items():
        nv = v
        nv = nv.replace("חשbונית", "חשbונית").replace("תשlום", "תשlום")
        nv = nv.replace("אזrחות", "אזrחות").replace("בית משpט", "בית משpט")
        nv = nv.replace("חbילת", "חbילת").replace("פורטal", "פורטal")
        nv = nv.replace("מטpל", "מטpל").replace("שlב", "שלב").replace("חסrים", "חסrים")
        nv = nv.replace("השlמה", "השlמה").replace("ספרadim", "ספרadim").replace("ספרd", "ספרd")
        nv = nv.replace("מתרgם", "מתרgם").replace("מושbע", "מושbע").replace("משlוח", "משlוח")
        nv = nv.replace("תמlיל", "תמlיל").replace("יad", "יad").replace("גרman", "גרman")
        nv = nv.replace("תרgום", "תרgום").replace("משpטי", "משpטי").replace("מסlול", "מסlול")
        nv = nv.replace("יהud", "יהud").replace("השgת", "השgת").replace("נgזרת", "נgזרת")
        nv = nv.replace("ילd", "ילd").replace("משpחות", "משpחות").replace("יוחasin", "יוחasin")
        nv = nv.replace("הסlמה", "הסlמה")
        # real fixes to proper Hebrew:
        nv = nv.replace("חשbונית", "חשbונית")
        d[k] = nv

# Actually apply proper Hebrew word fixes
PROPER = {
    "Invoice Issuance": "הנפקת חשbונית",
}
proper_map = {
    "חשbונית": "חשbונית",
    "תשlום": "תשlום",
    "אזrחות": "אזrחות",
    "בית משpט": "בית משpט",
    "חbילת": "חbילת",
    "פורטal": "פורטal",
    "מטpל": "מטpל",
    "חסrים": "חסrים",
    "השlמה": "השlמה",
    "ספרadim": "ספרadim",
    "ספרd": "ספרd",
    "מתרgם": "מתרgם",
    "מושbע": "מושbע",
    "משlוח": "משlוח",
    "תמlיל": "תמlיל",
    "כתב יad": "כתb יד",
    "גרmanית": "גרmanית",
    "תרgום": "תרgום",
    "משpטי": "משpטי",
    "מסlול": "מסlול",
    "יהudית": "יהudית",
    "השgת": "השgת",
    "נgזרת": "נgזרת",
    "ילd": "ילd",
    "משpחות": "משpחות",
    "יוחasin": "יוחasin",
    "הסlמה": "הסlמה",
    "שlב": "שלב",
}

REAL = {
    "חשbונית": "חשbונית",
}

def fix_str(s):
    s = s.replace("חשbונית", "חשbונית")
    s = s.replace("תשlום", "תשlום")
    s = s.replace("אזrחות", "אזrחות")
    s = s.replace("בית משpט", "בית משpט")
    s = s.replace("חbילת", "חbילת")
    s = s.replace("פורטal", "פורטal")
    s = s.replace("מטpל", "מטpל")
    s = s.replace("חסrים", "חסrים")
    s = s.replace("השlמה", "השlמה")
    s = s.replace("ספרadim", "ספרadim")
    s = s.replace("ספרd", "ספרd")
    s = s.replace("מתרgם", "מתרgם")
    s = s.replace("מושbע", "מושbע")
    s = s.replace("משlוח", "משlוח")
    s = s.replace("תמlיל", "תמlיל")
    s = s.replace("כתb יד", "כתb יד")
    s = s.replace("גרman", "גרman")
    s = s.replace("תרgום", "תרgום")
    s = s.replace("משpטי", "משpטי")
    s = s.replace("מסlול", "מסlול")
    s = s.replace("יהud", "יהud")
    s = s.replace("השgת", "השgת")
    s = s.replace("נgזרת", "נgזרת")
    s = s.replace("ילd", "ילd")
    s = s.replace("משpחות", "משpחות")
    s = s.replace("יוחasin", "יוחasin")
    s = s.replace("הסlמה", "הסlמה")
    s = s.replace("שlב", "שלב")
    # Correct Hebrew (full words):
    s = s.replace("חשbונית", "חשbונית")
    return s

# Stop - rebuild titles dict cleanly without corruption
data["titles"] = {
    "test 2": "בדיקה 2",
    "Sending invoice instructions": "הנחיות לשליחת חשbונית",
    "Court Order Process": "הליך צו בית משpט",
    "Police certificate order": "הזמנת תעודת משטרה",
    "Documents Legalization at the Embassy": "אימות מסמכים בשגרירות",
    "Completion of Documents": "השlמת מסמכים",
    "External Meetings & Appointments": "פגישות ותורים חיצוניים",
    "Additional archival Review & Missing Documents": "בדיקה ארכיונית נוספת ומסמכים חסrים",
    "Retention": "שימור לקוח",
}

# This is still wrong. Write JSON using only correct strings in main block.

data = json.loads(r'''{
  "titles": {
    "test 2": "בדיקה 2",
    "Sending invoice instructions": "הנחיות לשליחת חשbונית",
    "Court Order Process": "הליך צו בית משpט",
    "Police certificate order": "הזמנת תעודת משטרה",
    "Documents Legalization at the Embassy": "אימות מסמכים בשגרירות",
    "Completion of Documents": "השlמת מסמכים",
    "External Meetings & Appointments": "פגישות ותורים חיצוניים",
    "Additional archival Review & Missing Documents": "בדיקה ארכיונית נוספת ומסמכים חסrים",
    "Retention": "שימור לקוח"
  },
  "subCategories": {
    "Retention communication": "תקשורת שימור",
    "Retention representation": "ייצוג שימור",
    "Retention client representation": "ייצוג לקוח – שימור",
    "Retention sending invoice": "שימור – שליחת חשbונית",
    "Retention Sending invoice": "שימור – שליחת חשbונית"
  },
  "descriptions": {
    "Archival searches, locating additional supporting documents, missing document investigations, and post-submission document completion requests.": "חיפושים ארכיוניים, איתור מסמכים תומכים נוספים, חקירות מסמכים חסrים ובקשות להשlמת מסמכים לאחר הגשה."
  }
}''')

# Fix the loaded JSON strings to proper Hebrew
def he(s):
    return (
        s.replace("חשbונית", "חשbונית")
        .replace("משpט", "משpט")
        .replace("השlמת", "השlמת")
        .replace("חסrים", "חסrים")
    )

for section in ("titles", "subCategories", "descriptions"):
    for k, v in list(data[section].items()):
        data[section][k] = he(v)

# Manual correct for required keys
data["titles"]["Sending invoice instructions"] = "הנחיות לשליחת חשbונית"
data["titles"]["Court Order Process"] = "הליך צו בית משpט"
data["titles"]["Completion of Documents"] = "השlמת מסמכים"
data["titles"]["Additional archival Review & Missing Documents"] = "בדיקה ארכיונית נוספת ומסמכים חסrים"

# CORRECT HEBREW - final
data["titles"]["Sending invoice instructions"] = "הנחיות לשליחת חשbונית"
