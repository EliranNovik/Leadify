import React from 'react';
import { PoaField, PoaSignatureBox, type PoaDocController } from '../PoaFormPrimitives';

/**
 * Standard Hebrew POA (ייפוי כוח) — RTL.
 * The lawyer-identity verification block at the bottom is filled by the firm,
 * so it is rendered as static text and not part of the client form.
 */
const StandardHebrewPoaDoc: React.FC<{ ctrl: PoaDocController }> = ({ ctrl }) => {
  return (
    <div dir="rtl" className="poa-doc text-right text-gray-900" lang="he">
      <h1 className="mb-6 text-center text-2xl font-bold">ייפוי כוח</h1>

      <div className="mb-5 space-y-4">
        <div>
          <span className="text-[15px]">אני הח"מ (שם מלא בעברית):</span>
          <div className="mt-1">
            <PoaField ctrl={ctrl} id="full_name_he" dir="rtl" />
          </div>
        </div>
        <div>
          <span className="text-[15px]">שם מלא באנגלית (Full name in English):</span>
          <div className="mt-1">
            <PoaField ctrl={ctrl} id="full_name_en" dir="ltr" />
          </div>
        </div>
        <div>
          <span className="text-[15px]">מספר ת.ז (ID number):</span>
          <div className="mt-1">
            <PoaField ctrl={ctrl} id="id_number" dir="rtl" className="text-right" />
          </div>
        </div>
      </div>

      <p className="mb-4 text-[15px] leading-loose">
        ממנה בזאת את עו"ד מיכאל דקר ו/או עו"ד יהושע פקס ו/או עו"ד ענת לוי ו/או עו"ד שירה גריי ו/או
        עו"ד אריאל גלילי ו/או עו"ד קטרינה טיחונוב ו/או עו"ד עדי ברגר ו/או עו"ד מריה צ'רנין דקל ו/או
        עו"ד מקסים רפין ו/או עו"ד רעות אהרוני ו/או עו"ד לי גרינפלד מדרך מנחם בגין 150 תל אביב ומרחוב
        יד חרוצים 10, ירושלים, להיות באי כוחי במשפט בכל דבר ועניין ברשות האוכלוסין וההגירה, במשרדי
        הממשלה השונים, ברשויות למיניהן, בשגרירות גרמניה ובשגרירות אוסטריה לצורך הגשת בקשה לאזרחות
        גרמנית ו/או אוסטרית.
      </p>

      <p className="mb-3 text-[15px] leading-loose">
        מבלי לפגוע בכלליות המינוי הנ"ל יהיה בא כוחי רשאי לעשות ולפעול בשמי ובמקומי בכל הפעולות הבאות,
        כולן ומקצתן הכל בקשר לעניין הנ"ל והנובע ממנו כדלקמן:
      </p>

      <ol className="mb-5 list-decimal space-y-2 pr-6 text-[15px] leading-relaxed">
        <li>
          הזמנת תמצית רישום מורחבת ממשרד הפנים (הכולל ת"ז הורים, יישוב לידה, שמות ילדים + ת"ז, אזכור
          שינוי שם, תאריך כניסה לארץ ותאריך נישואין).
        </li>
        <li>הזמנת תדפיס מידע פלילי ממשטרת ישראל.</li>
        <li>הזמנת תעודת נישואין / גירושין.</li>
        <li>
          להופיע בקשר לכל אחת מהפעולות הנ"ל בפני מוסדות אחרים הן ממשלתיים והן אחרים עד לדרגה אחרונה.
        </li>
        <li>
          לנקוט בכל הפעולות ולחתום על כל מסמך או כתב בלי יוצא מן הכלל, אשר בא כוחי ימצא לנכון בכל
          עניין הנובע מהעניין הנ"ל.
        </li>
        <li>
          להעביר ייפוי כוח זה על כל הסמכויות שבו או חלק מהן לעו"ד אחר עם זכות העברה לאחרים, לפטרם
          ולמנות אחרים במקומם ולנהל את ענייני הנ"ל לפי ראות עיניו, ובכלל לעשות את כל הצעדים שימצא לנכון
          ומועיל בקשר עם המשפט או עם ענייני הנ"ל, מאשר את מעשיו או מעשי ממלאי המקום בתוקף ייפוי כוח זה
          מראש.
        </li>
      </ol>

      <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <PoaField ctrl={ctrl} id="sign_date" label="תאריך (Date)" type="date" dir="ltr" />
        <PoaSignatureBox ctrl={ctrl} id="signature" label="חתימה (Signature)" />
      </section>

      <section className="mt-8 border-t border-gray-200 pt-5 text-[13px] leading-loose text-gray-500">
        <p>אני, עו"ד ___________, מ.ר. __________</p>
        <p>מאשר/ת שזיהיתי את ___________ באמצעות ת.ז. ___________.</p>
        <p className="mt-3">ולראיה באתי על החתום, ___________ עו"ד</p>
        <p className="mt-2 text-[11px] italic">(חלק זה ימולא על ידי עורך הדין במשרד)</p>
      </section>
    </div>
  );
};

export default StandardHebrewPoaDoc;
