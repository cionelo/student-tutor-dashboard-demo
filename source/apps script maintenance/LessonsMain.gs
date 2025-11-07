
function cleanNewTitles() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Main");
    const lastRow = sheet.getLastRow();
  
    for (let row = 2; row <= lastRow; row++) {
      const marker = sheet.getRange(row, 22).getValue(); // Column V
      if (marker === true) continue; // Skip already processed rows
  
      const rawValue = sheet.getRange(row, 21).getValue(); // Column U
      const nameCell = sheet.getRange(row, 1); // Column A
      const activityCell = sheet.getRange(row, 20); // Column T
      const timestampCell = sheet.getRange(row, 23); // Column W
  
      if (typeof rawValue !== 'string' || rawValue.trim() === '') {
        sheet.getRange(row, 22).setValue(true); // Mark as processed
        timestampCell.setValue(new Date());     // Log timestamp
        continue;
      }
  
      const cleaned = rawValue
        .replace(/\s*-\s*/g, '|') // Replace " - " with "|"
        .replace(/\s+/g, ' ')     // Collapse multiple spaces
        .trim();
  
      const parts = cleaned.split('|');
      const name = parts[0].trim();
      const activity = parts[1] ? parts[1].trim() : 'N/A';
  
      const wordCount = name.split(/\s+/).length;
      const isValidName = wordCount >= 2 && /^[a-zA-Z\s()]+$/.test(name);
  
      if (!isValidName) {
        nameCell.setValue(name);
        activityCell.setValue('Invalid format');
      } else {
        nameCell.setValue(name);
        activityCell.setValue(activity);
      }
  
      sheet.getRange(row, 22).setValue(true);     // ✅ Mark as processed
      timestampCell.setValue(new Date());         // 🕒 Log timestamp
    }
  }
  
  //fix student ID issue
  /***** CONFIG: set your IDs if not already in the file *****/
  const AVAIL_SHEET_ID   = '1kA70FU2YGy5gTtkfFrlz2tsJ7-bDZ7Tm54gGQ0IUIUo'; // Availabilities → Subjects (unused here)
  const LESSONS_SHEET_ID = '1SEKrq9CesJqTDmTS5KgTi6VVDuaL7109aFIm4UGFL5A'; // Lessons_Fall25 → Main
  const DATA_SHEET_ID    = '19WJVLuy5nbvQqpl5d3bA8ocKU8A1C_5m9etrJmf1fsQ'; // Dashboard_Data
  
  const TABS = {
    lessonsSrc: 'Main',       // in Lessons_Fall25
    students:   'Students',   // in Dashboard_Data
  };
  
  function openByIdAndName(id, tab){ return SpreadsheetApp.openById(id).getSheetByName(tab); }
  
  function getHeaderMap(values){
    const H = values[0].map(h => String(h).trim());
    const idx = {};
    H.forEach((h,i)=> idx[h] = i);
    return { H, idx };
  }
  
  // 1) Cleaner: remove ANY (...) and collapse spaces
  function cleanName(raw){
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/\([^)]*\)/g, ' ');  // remove all parentheticals
    s = s.replace(/[\u2019']/g, "'");  // normalize apostrophes
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }
  
  
  function splitFullName(name){
    // very simple split: first token = first name, last token = last name
    const parts = String(name||'').trim().split(/\s+/);
    if (parts.length >= 2) return { first: parts[0], last: parts[parts.length-1] };
    return { first: parts[0] || '', last: '' };
  }
  
  // 2) Load Students index: accept 'student_id' or 'Student ID', and 'First Name'/'Last Name'
  function loadStudentsIndex(){
    const sh = openByIdAndName(DATA_SHEET_ID, TABS.students);
    const vals = sh.getDataRange().getValues();
    if (vals.length < 2) return [];
  
    const { H, idx } = getHeaderMap(vals);
  
    const idKey = ('student_id' in idx) ? 'student_id'
               : ('Student ID' in idx) ? 'Student ID'
               : null;
    if (!idKey) throw new Error("Students tab needs 'student_id' or 'Student ID'");
  
    const firstKey = ('first_name' in idx) ? 'first_name'
                   : ('First Name' in idx) ? 'First Name'
                   : null;
    const lastKey  = ('last_name' in idx)  ? 'last_name'
                   : ('Last Name' in idx)  ? 'Last Name'
                   : null;
  
    if (!firstKey || !lastKey) {
      throw new Error("Students tab needs 'First Name' and 'Last Name'");
    }
  
    const out = [];
    for (let i=1;i<vals.length;i++){
      const row = vals[i];
      if (!row.some(c => c!=='')) continue;
  
      const sid = String(row[idx[idKey]] || '').trim();
      const first = cleanName(row[idx[firstKey]]).toLowerCase();
      const last  = cleanName(row[idx[lastKey]]).toLowerCase();
      if (!sid || !first || !last) continue;
  
      out.push({ sid, first, last, full: (first + ' ' + last) });
    }
    return out;
  }
  
  function ensureLessonsStudentIdColumn(){
    const sh = openByIdAndName(LESSONS_SHEET_ID, TABS.lessonsSrc);
    const vals = sh.getDataRange().getValues();
    if (vals.length === 0) throw new Error('Lessons sheet is empty');
    const { H } = getHeaderMap(vals);
    if (!H.includes('Student ID')) {
      sh.insertColumnAfter(H.length);
      sh.getRange(1, H.length+1).setValue('Student ID');
    }
  }
  
  // 3) Matcher: require both first & last to appear as words in Lessons 'Student'
  function findStudentIdForLesson(studentsIndex, lessonStudentText){
    const cleaned = cleanName(lessonStudentText).toLowerCase(); // e.g., "Sophia Martin (Geometry)" -> "sophia martin"
    if (!cleaned) return '';
  
    // tokenize on spaces/punctuation; keep simple
    const words = new Set(cleaned.split(/[^a-zA-Z0-9']+/).filter(Boolean));
  
    // candidate if both first and last are present as tokens (or clear word boundaries)
    const candidates = studentsIndex.filter(s => {
      const f = s.first, l = s.last;
      const firstOK = words.has(f) || new RegExp(`\\b${escapeRegExp(f)}\\b`).test(cleaned);
      const lastOK  = words.has(l) || new RegExp(`\\b${escapeRegExp(l)}\\b`).test(cleaned);
      return firstOK && lastOK;
    });
  
    if (candidates.length === 1) return candidates[0].sid;
  
    // tie-breaker: exact "first last" substring
    if (candidates.length > 1) {
      const narrowed = candidates.filter(s => cleaned.includes(s.full));
      if (narrowed.length === 1) return narrowed[0].sid;
    }
  
    return ''; // ambiguous/no match → skip
  }
  function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /////
  function dryRunBackfillStudentId(){
    const studentsIndex = loadStudentsIndex();
    const sh = openByIdAndName(LESSONS_SHEET_ID, TABS.lessonsSrc);
    const vals = sh.getDataRange().getValues();
    const { idx } = getHeaderMap(vals);
  
    if (idx['Student'] == null) throw new Error("Lessons 'Main' must have a 'Student' column");
  
    let total=0, matches=0, multi=0, none=0;
    const examples = { matched:[], ambiguous:[], no_match:[] };
  
    for (let i=1;i<vals.length;i++){
      const nameText = vals[i][idx['Student']];
      if (!nameText) continue;
      total++;
  
      const cleaned = cleanName(nameText);
      const hay = cleaned.toLowerCase();
      const cands = studentsIndex.filter(s => s.first && s.last && hay.includes(s.first) && hay.includes(s.last));
  
      if (cands.length === 1){
        matches++;
        if (examples.matched.length < 5) examples.matched.push({ row:i+1, student:cleaned, sid:cands[0].sid });
      } else if (cands.length > 1){
        multi++;
        if (examples.ambiguous.length < 5) examples.ambiguous.push({ row:i+1, student:cleaned, count:cands.length });
      } else {
        none++;
        if (examples.no_match.length < 5) examples.no_match.push({ row:i+1, student:cleaned });
      }
    }
  
    const summary = { ok:true, considered:total, unique_matches:matches, ambiguous:multi, no_match:none, examples };
    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }
  
  function applyBackfillStudentId(){
    ensureLessonsStudentIdColumn();
  
    const studentsIndex = loadStudentsIndex();
    const sh = openByIdAndName(LESSONS_SHEET_ID, TABS.lessonsSrc);
    const rng = sh.getDataRange();
    const vals = rng.getValues();
    const { idx } = getHeaderMap(vals);
  
    const colStudent   = idx['Student'];
    const colStudentId = idx['Student ID'];
    if (colStudent == null || colStudentId == null) throw new Error('Missing Student or Student ID column');
  
    let written = 0, skipped = 0;
  
    for (let i=1;i<vals.length;i++){
      const nameText = vals[i][colStudent];
      if (!nameText) continue;
  
      // don’t overwrite existing IDs
      const current = String(vals[i][colStudentId] || '').trim();
      if (current) { skipped++; continue; }
  
      const sid = findStudentIdForLesson(studentsIndex, nameText);
      if (sid) { vals[i][colStudentId] = sid; written++; }
      else { skipped++; }
    }
  
    rng.setValues(vals);
    const res = { ok:true, student_id_written: written, skipped };
    Logger.log(JSON.stringify(res, null, 2));
    return res;
  }
  
  
  