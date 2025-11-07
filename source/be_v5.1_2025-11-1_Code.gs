/**
 * Dashboard_Data - Complete Backend API + Maintenance
 * Version: 5.1
 * Session: Phase 2 UI updates
 * Date: 2025-11-1
 * Snapshot: v5.1
 * 
 * Features:
 * - Fixed login: checks Availabilities first (tutor), then Students
 * - Hybrid caching: preload tutors + student list, lazy load team/comments
 * - Safe cache with 90KB size checks
 * - Link map with MM/DD/YY formatting
 * - Full student data in preload
 */


/***** CONFIG *****/
const AVAIL_SHEET_ID   = 'SHEET_ID_1';
const LESSONS_SHEET_ID = 'SHEET_ID_2';
const DATA_SHEET_ID    = 'SHEET_ID_3';

const TABS = {
  tutorsSrc:   'Subjects',
  lessonsSrc:  'Main',
  students:    'Students',
  studentInfo: 'Student Info',
  intake:      'Intake',
  comments:    'Comments',
  links:       'TutorStudent',
  notifications: 'Notifications'
};

const ADMIN_PIN = '6767676767';

/***** HELPERS *****/
function _sheet(id, tab) {
  const ss = SpreadsheetApp.openById(String(id).trim());
  const sh = ss.getSheetByName(tab);
  if (!sh) throw new Error(`Tab not found: ${tab}`);
  return sh;
}

function openData(tab) { return _sheet(DATA_SHEET_ID, tab); }

function normStr(s) { return String(s == null ? '' : s).trim(); }

function toBool(v) { return String(v).toLowerCase() === 'true'; }

function findColMulti(headers, names) {
  const lower = headers.map(h => String(h).toLowerCase().trim());
  for (const name of names) {
    const i = lower.indexOf(String(name).toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function generateUUID() { return Utilities.getUuid(); }

/***** JSON RESPONSES *****/
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/***** SESSION MANAGEMENT *****/
const SESSION_TTL_SECONDS = 60 * 60;

function _cache() { return CacheService.getScriptCache(); }

function _createSession_(viewer) {
  const key = Utilities.getUuid();
  _cache().put('sess:' + key, JSON.stringify(viewer), SESSION_TTL_SECONDS);
  return key;
}

function _getSession_(key) {
  const raw = key ? _cache().get('sess:' + key) : null;
  if (!raw) throw new Error('Session expired or invalid. Please sign in again.');
  return JSON.parse(raw);
}

/***** FIXED LOGIN - CHECKS TUTORS FIRST *****/
function _login_(employeeId, isAdmin) {
  const empId = normStr(employeeId);
  
  if (isAdmin) {
    return { 
      role: 'admin', 
      tutor_id: empId, 
      first_name: 'Admin',
      last_name: '',
      allowed_students: [] 
    };
  }
  
  // Step 1: Check if ID exists in Availabilities → Subjects (TUTOR CHECK)
  try {
    const tutorSh = _sheet(AVAIL_SHEET_ID, TABS.tutorsSrc);
    const tutorVals = tutorSh.getDataRange().getValues();
    const tutorH = tutorVals[0];
    
    const iProfile = findColMulti(tutorH, ['profile id', 'employee id']);
    const iFirst = findColMulti(tutorH, ['first name']);
    const iLast = findColMulti(tutorH, ['last name']);
    const iStatus = findColMulti(tutorH, ['status']);
    
    for (let i = 1; i < tutorVals.length; i++) {
      const tutorId = normStr(tutorVals[i][iProfile]);
      const status = iStatus >= 0 ? normStr(tutorVals[i][iStatus]) : 'active';
      
      if (tutorId === empId && (!status || status.toLowerCase() === 'active')) {
        // FOUND AS TUTOR!
        const firstName = iFirst >= 0 ? normStr(tutorVals[i][iFirst]) : '';
        const lastName = iLast >= 0 ? normStr(tutorVals[i][iLast]) : '';
        
        // Get their students from TutorStudent
        const linksSh = openData(TABS.links);
        const linksVals = linksSh.getDataRange().getValues();
        const linksH = linksVals[0];
        const iSid = findColMulti(linksH, ['student_id', 'student id']);
        const iTid = findColMulti(linksH, ['tutor_id', 'employee_id']);
        const iActive = findColMulti(linksH, ['active']);
        
        const students = [];
        linksVals.slice(1).forEach(r => {
          const sid = normStr(r[iSid]);
          const tid = normStr(r[iTid]);
          const active = iActive >= 0 ? toBool(r[iActive]) : true;
          if (active && tid === empId) {
            students.push(sid);
          }
        });
        
        console.log(`✅ Login as TUTOR: ${firstName} ${lastName} (${empId}) - ${students.length} students`);
        
        return { 
          role: 'tutor', 
          tutor_id: empId,
          first_name: firstName,
          last_name: lastName,
          allowed_students: students 
        };
      }
    }
  } catch (e) {
    console.warn('⚠️ Could not check tutor sheet:', e);
  }
  
  // Step 2: Not a tutor, treat as student (shouldn't happen in your case)
  console.warn(`⚠️ ID ${empId} not found as active tutor`);
  return { 
    role: 'student', 
    tutor_id: empId,
    first_name: empId,
    last_name: '',
    allowed_students: [] 
  };
}

/***** CACHE UTILITIES *****/
function _getCacheBustKey() {
  try {
    const file = DriveApp.getFileById(DATA_SHEET_ID);
    return String(file.getLastUpdated().getTime());
  } catch (e) {
    return String(new Date().getTime());
  }
}

function _cachePutSafe(key, obj, ttl = 3600) {
  try {
    const json = JSON.stringify(obj);
    const sizeKB = Math.round(json.length / 1024);
    
    if (json.length > 90 * 1024) {
      console.warn(`⚠️ Cache skip: ${key} (${sizeKB}KB exceeds 90KB limit)`);
      return false;
    }
    
    _cache().put(key, json, ttl);
    console.log(`✅ Cached: ${key} (${sizeKB}KB)`);
    return true;
  } catch (e) {
    console.error(`❌ Cache error for ${key}:`, e);
    return false;
  }
}

function _cacheGetSafe(key) {
  try {
    const raw = _cache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error(`❌ Cache read error for ${key}:`, e);
    return null;
  }
}

/***** PRELOAD BUNDLE - SIMPLIFIED (NO TEAM/COMMENTS) *****/
function getPreloadBundle(sessionKey) {
  try {
    const viewer = _getSession_(sessionKey);
    const bust = _getCacheBustKey();
    
    const cacheKey = `preload:${viewer.tutor_id}:${bust}`;
    let cached = _cacheGetSafe(cacheKey);
    if (cached) {
      console.log(`📦 Preload from cache for ${viewer.tutor_id}`);
      return { ok: true, ...cached, fromCache: true };
    }
    
    console.log(`🔄 Building preload bundle for ${viewer.tutor_id}...`);
    
    // 1. Tutor Directory
    const tutorDirectory = getTutorDirectory_internal();
    
    // 2. Full Student Data (NO team/comments - lazy loaded)
    const studentData = getStudentsComplete_internal(viewer);
    
    // 3. Link Map (for tooltips)
    const studentIds = studentData.map(s => s.student_id);
    const linkMap = getTutorLinkMap_internal(studentIds, viewer);
    
    const bundle = {
      viewer: {
        role: viewer.role,
        tutor_id: viewer.tutor_id,
        first_name: viewer.first_name,
        last_name: viewer.last_name
      },
      tutorDirectory,
      studentData,
      linkMap,
      bust
    };
    

    _cachePutSafe(cacheKey, bundle, 3600);

    const payloadSize = JSON.stringify(bundle).length;
    console.log(`✅ Preload built: ${tutorDirectory.length} tutors, ${studentData.length} students (${Math.round(payloadSize / 1024)}KB)`);

    return { ok: true, ...bundle, fromCache: false };
    
  } catch (e) {
    console.error('❌ getPreloadBundle error:', e);
    return { ok: false, error: e.message };
  }
}

/***** TUTOR DIRECTORY *****/
function getTutorDirectory_internal() {
  const sh = _sheet(AVAIL_SHEET_ID, TABS.tutorsSrc);
  const vals = sh.getDataRange().getValues();
  const H = vals[0];
  
  const iProfile = findColMulti(H, ['profile id', 'employee id']);
  const iFirst = findColMulti(H, ['first name']);
  const iLast = findColMulti(H, ['last name']);
  const iEmail = findColMulti(H, ['email']);
  const iMobile = findColMulti(H, ['mobile phone', 'cell']);
  const iPhone = findColMulti(H, ['phone']);
  const iStatus = findColMulti(H, ['status']);
  
  return vals.slice(1)
    .map(r => ({
      tutor_id: normStr(r[iProfile]),
      first_name: normStr(r[iFirst]),
      last_name: normStr(r[iLast]),
      email: normStr(r[iEmail]),
      phone_mobile: normStr(r[iMobile]),
      phone: normStr(r[iPhone]),
      status: iStatus >= 0 ? normStr(r[iStatus]) : ''
    }))
    .filter(t => t.tutor_id && (!t.status || t.status.toLowerCase() === 'active'));
}

/***** COMPLETE STUDENT DATA *****/
function getStudentsComplete_internal(viewer) {
  const sh = openData(TABS.students);
  const vals = sh.getDataRange().getValues();
  const H = vals[0];
  const iSchool = findColMulti(H, ['school']);
  const iSid = findColMulti(H, ['student id']);
  const iFirst = findColMulti(H, ['first name']);
  const iLast = findColMulti(H, ['last name']);
  const iGrade = findColMulti(H, ['grade']);
  const iEmail = findColMulti(H, ['email']);
  const iMobile = findColMulti(H, ['mobile phone', 'cell']);
  const iBio = findColMulti(H, ['bio']);
  const iNotes = findColMulti(H, ['additional notes', 'notes']);
  const iFamFirst = findColMulti(H, ['family first name', 'parent first']);
  const iFamLast = findColMulti(H, ['family last name', 'parent last']);
  const iFamMobile = findColMulti(H, ['family mobile', 'parent mobile']);
  const iFamHome = findColMulti(H, ['family home', 'parent home']);
  const iFamEmail = findColMulti(H, ['family email', 'parent email']);
  
  let students = vals.slice(1)
    .map(r => ({
      student_id: normStr(r[iSid]),
      first_name: normStr(r[iFirst]),
      last_name: normStr(r[iLast]),
      grade: iGrade >= 0 ? normStr(r[iGrade]) : '',
      email: normStr(r[iEmail]),
      mobile_phone: iMobile >= 0 ? normStr(r[iMobile]) : '',
      school: iSchool >= 0 ? normStr(r[iSchool]) : '',
      bio: iBio >= 0 ? normStr(r[iBio]) : '',
      additional_notes: iNotes >= 0 ? normStr(r[iNotes]) : '',
      family_first: iFamFirst >= 0 ? normStr(r[iFamFirst]) : '',
      family_last: iFamLast >= 0 ? normStr(r[iFamLast]) : '',
      family_mobile: iFamMobile >= 0 ? normStr(r[iFamMobile]) : '',
      family_home: iFamHome >= 0 ? normStr(r[iFamHome]) : '',
      family_email: iFamEmail >= 0 ? normStr(r[iFamEmail]) : ''
    }))
    .filter(s => s.student_id);
  
  // Scope by viewer permissions
  if (viewer.role !== 'admin') {
    const allowedSet = new Set(viewer.allowed_students || []);
    students = students.filter(s => allowedSet.has(s.student_id));
  }
  
  return students;
}

/***** STUDENT BUNDLE - LAZY LOAD (team + comments) *****/
function getStudentBundle(sessionKey, studentId) {
  try {
    const viewer = _getSession_(sessionKey);
    
    // Permission check
    if (viewer.role !== 'admin') {
      const allowedSet = new Set(viewer.allowed_students || []);
      if (!allowedSet.has(normStr(studentId))) {
        return { ok: false, error: 'Access denied' };
      }
    }
    
    // Get student from Students sheet
    const sh = openData(TABS.students);
    const vals = sh.getDataRange().getValues();
    const H = vals[0];
    
    const iSid = findColMulti(H, ['student id']);
    
    let student = null;
    for (let i = 1; i < vals.length; i++) {
      if (normStr(vals[i][iSid]) === normStr(studentId)) {
        // Found student - get all fields
        const iFirst = findColMulti(H, ['first name']);
        const iLast = findColMulti(H, ['last name']);
        const iGrade = findColMulti(H, ['grade']);
        const iEmail = findColMulti(H, ['email']);
        const iMobile = findColMulti(H, ['mobile phone', 'cell']);
        const iSchool = findColMulti(H, ['school']);
        const iBio = findColMulti(H, ['bio']);
        const iNotes = findColMulti(H, ['additional notes', 'notes']);
        const iFamFirst = findColMulti(H, ['family first name', 'parent first']);
        const iFamLast = findColMulti(H, ['family last name', 'parent last']);
        const iFamMobile = findColMulti(H, ['family mobile', 'parent mobile']);
        const iFamHome = findColMulti(H, ['family home', 'parent home']);
        const iFamEmail = findColMulti(H, ['family email', 'parent email']);
        
        student = {
          student_id: normStr(vals[i][iSid]),
          first_name: normStr(vals[i][iFirst]),
          last_name: normStr(vals[i][iLast]),
          grade: iGrade >= 0 ? normStr(vals[i][iGrade]) : '',
          email: normStr(vals[i][iEmail]),
          mobile_phone: iMobile >= 0 ? normStr(vals[i][iMobile]) : '',
          school: iSchool >= 0 ? normStr(vals[i][iSchool]) : '',
          bio: iBio >= 0 ? normStr(vals[i][iBio]) : '',
          additional_notes: iNotes >= 0 ? normStr(vals[i][iNotes]) : '',
          family_first: iFamFirst >= 0 ? normStr(vals[i][iFamFirst]) : '',
          family_last: iFamLast >= 0 ? normStr(vals[i][iFamLast]) : '',
          family_mobile: iFamMobile >= 0 ? normStr(vals[i][iFamMobile]) : '',
          family_home: iFamHome >= 0 ? normStr(vals[i][iFamHome]) : '',
          family_email: iFamEmail >= 0 ? normStr(vals[i][iFamEmail]) : ''
        };
        break;
      }
    }
    // Get latest past_courses from Student Info sheet
    if (student) {
      try {
        const infoSh = openData(TABS.studentInfo);
        const infoVals = infoSh.getDataRange().getValues();
        const infoH = infoVals[0];
        
        const iInfoSid = findColMulti(infoH, ['student_id', 'student id']);
        const iPastCourses = findColMulti(infoH, ['past_courses', 'past courses']);
        
        let latestPastCourses = '';
        if (iPastCourses >= 0 && iInfoSid >= 0) {
          // Scan from bottom up (most recent first)
          for (let i = infoVals.length - 1; i >= 1; i--) {
            if (normStr(infoVals[i][iInfoSid]) === normStr(studentId)) {
              const courses = normStr(infoVals[i][iPastCourses]);
              if (courses) {
                latestPastCourses = courses;
                break; // Found most recent
              }
            }
          }
        }
        
        student.past_courses = latestPastCourses;
      } catch (e) {
        console.warn('⚠️ Could not fetch past_courses:', e);
        student.past_courses = '';
      }
    }
    if (!student) {
      return { ok: false, error: 'Student not found' };
    }
    
    // Get team
    const team = getTeam_internal(studentId, viewer);
    
    // Get comments
    const comments = getComments_internal(studentId, viewer);
    
    console.log(`✅ Bundle for ${studentId}: ${team.length} team, ${comments.length} comments`);
    
    return {
      ok: true,
      student,
      team,
      comments
    };
    
  } catch (e) {
    console.error('❌ getStudentBundle error:', e);
    return { ok: false, error: e.message };
  }
}

/***** TEAM DATA *****/
function getTeam_internal(studentId, viewer) {
  const linksSh = openData(TABS.links);
  const linksVals = linksSh.getDataRange().getValues();
  const linksH = linksVals[0];
  
  const iSid = findColMulti(linksH, ['student_id', 'student id']);
  const iTid = findColMulti(linksH, ['tutor_id', 'employee_id']);
  const iRole = findColMulti(linksH, ['role']);
  const iSubject = findColMulti(linksH, ['subject']);
  const iActive = findColMulti(linksH, ['active']);
  const iLastSeen = findColMulti(linksH, ['last_seen', 'last seen']);
  
  const team = [];
  
  linksVals.slice(1).forEach(r => {
    const sid = normStr(r[iSid]);
    const tid = normStr(r[iTid]);
    const role = normStr(r[iRole]);
    const subject = normStr(r[iSubject]);
    const active = iActive >= 0 ? toBool(r[iActive]) : true;
    const lastSeenRaw = iLastSeen >= 0 ? r[iLastSeen] : null;
    
    if (sid !== normStr(studentId)) return;
    if (!active) return;
    
    // Format last_seen
    let lastSeen = 'Unknown';
    if (lastSeenRaw) {
      const date = lastSeenRaw instanceof Date ? lastSeenRaw : new Date(lastSeenRaw);
      if (!isNaN(date.getTime())) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        lastSeen = `${month}/${day}/${year}`;
      }
    }
    
    team.push({
      tutor_id: tid,
      role,
      subject,
      last_seen: lastSeen
    });
  });
  
  return team;
}

/***** COMMENTS DATA *****/
function getComments_internal(studentId, viewer) {
  const sh = openData(TABS.comments);
  const vals = sh.getDataRange().getValues();
  const H = vals[0];
  
  const iSid = findColMulti(H, ['student_id', 'student id']);
  const iTid = findColMulti(H, ['tutor_id', 'employee_id']);
  const iTs = findColMulti(H, ['timestamp', 'timestamp_iso']);
  const iBody = findColMulti(H, ['body']);
  
  const comments = [];
  
  vals.slice(1).forEach(r => {
    const sid = normStr(r[iSid]);
    const tid = normStr(r[iTid]);
    const ts = iTs >= 0 ? r[iTs] : null;
    const body = normStr(r[iBody]);
    
    if (sid !== normStr(studentId)) return;
    if (!body) return;
    
    const timestamp = ts instanceof Date ? ts.toISOString() : (ts ? String(ts) : new Date().toISOString());
    
    comments.push({
      tutor_id: tid,
      timestamp,
      body
    });
  });
  
  return comments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/***** LINK MAP *****/
function getTutorLinkMap_internal(studentIds, viewer) {
  const sh = openData(TABS.links);
  const vals = sh.getDataRange().getValues();
  const H = vals[0];
  
  const iSid = findColMulti(H, ['student_id', 'student id']);
  const iTid = findColMulti(H, ['tutor_id', 'employee_id']);
  const iRole = findColMulti(H, ['role']);
  const iSubject = findColMulti(H, ['subject']);
  const iActive = findColMulti(H, ['active']);
  const iLastSeen = findColMulti(H, ['last_seen', 'last seen']);
  
  const idSet = new Set(studentIds.map(normStr));
  const tempMap = {};
  
  vals.slice(1).forEach(r => {
    const sid = normStr(r[iSid]);
    const tid = normStr(r[iTid]);
    const role = normStr(r[iRole]);
    const subject = normStr(r[iSubject]);
    const active = iActive >= 0 ? toBool(r[iActive]) : true;
    const lastSeenRaw = iLastSeen >= 0 ? r[iLastSeen] : null;
    
    if (!idSet.has(sid)) return;
    
    let lastSeenDate = null;
    if (lastSeenRaw) {
      if (lastSeenRaw instanceof Date) {
        lastSeenDate = lastSeenRaw;
      } else {
        const parsed = new Date(lastSeenRaw);
        if (!isNaN(parsed.getTime())) {
          lastSeenDate = parsed;
        }
      }
    }
    
    const dedupKey = `${sid}|${tid}|${subject}`;
    
    if (!tempMap[dedupKey]) {
      tempMap[dedupKey] = { sid, tid, role, subject, active, lastSeenDate };
    } else {
      const existing = tempMap[dedupKey];
      if (lastSeenDate && (!existing.lastSeenDate || lastSeenDate > existing.lastSeenDate)) {
        tempMap[dedupKey].lastSeenDate = lastSeenDate;
        tempMap[dedupKey].role = role;
        tempMap[dedupKey].active = active;
      }
    }
  });
  
  const linkMap = {};
  
  Object.values(tempMap).forEach(link => {
    const { sid, tid, role, subject, active, lastSeenDate } = link;
    
    let lastSeenFormatted = 'Unknown';
    if (lastSeenDate) {
      const month = String(lastSeenDate.getMonth() + 1).padStart(2, '0');
      const day = String(lastSeenDate.getDate()).padStart(2, '0');
      const year = String(lastSeenDate.getFullYear()).slice(-2);
      lastSeenFormatted = `${month}/${day}/${year}`;
    }
    
    if (!linkMap[sid]) linkMap[sid] = [];
    
    linkMap[sid].push({
      tutor_id: tid,
      role,
      subject,
      last_seen: lastSeenFormatted,
      active
    });
  });
  
  return linkMap;
}

/***** UPDATE STUDENT NOTES *****/
function updateStudentNotes(sessionKey, studentId, notes) {
  try {
    const viewer = _getSession_(sessionKey);
    
    // Permission check
    if (viewer.role !== 'admin') {
      const allowedSet = new Set(viewer.allowed_students || []);
      if (!allowedSet.has(normStr(studentId))) {
        return { ok: false, error: 'Access denied' };
      }
    }
    
    // Append to Student Info sheet (append-only)
    const sh = openData(TABS.studentInfo);
    const timestamp = new Date().toISOString();
    const author = `${viewer.tutor_id}|${timestamp}`;
    
    sh.appendRow([
      studentId,
      notes,
      author
    ]);
    
    console.log(`✅ Appended note for ${studentId} by ${viewer.tutor_id}`);
    
    return { ok: true };
    
  } catch (e) {
    console.error('❌ updateStudentNotes error:', e);
    return { ok: false, error: e.message };
  }
}
/***** UPDATE PAST COURSES  *****/
function appendPastCourses(studentId, pastCourses, tutorId) {
  try {
    const sh = openData('Student Info');
    const vals = sh.getDataRange().getValues();
    const headers = vals[0];
    
    const idCol = findColMulti(headers, ['student_id', 'student id']);
    const coursesCol = findColMulti(headers, ['past_courses', 'past courses']);
    const tsCol = findColMulti(headers, ['past_courses_ts_author']);
    
    if (idCol < 0 || coursesCol < 0 || tsCol < 0) {
      return { ok: false, error: 'Missing columns in Student Info sheet' };
    }
    
    const lastRow = sh.getLastRow();
    sh.insertRowsAfter(lastRow, 1);
    const newRow = lastRow + 1;
    
    const rowData = Array(headers.length).fill('');
    rowData[idCol] = String(studentId).trim();
    rowData[coursesCol] = String(pastCourses).trim();
    rowData[tsCol] = `${tutorId}|${new Date().toISOString()}`;
    
    sh.getRange(newRow, 1, 1, headers.length).setValues([rowData]);
    
    return { 
      ok: true, 
      student_id: studentId,
      row: newRow,
      created_at: new Date().toISOString()
    };
  } catch (err) {
    console.error('appendPastCourses error:', err);
    return { ok: false, error: err.message };
  }
}
/***** ADD COMMENT *****/
function addComment(sessionKey, studentId, body) {
  try {
    const viewer = _getSession_(sessionKey);
    
    // Permission check
    if (viewer.role !== 'admin') {
      const allowedSet = new Set(viewer.allowed_students || []);
      if (!allowedSet.has(normStr(studentId))) {
        return { ok: false, error: 'Access denied' };
      }
    }
    
    const sh = openData(TABS.comments);
    const timestamp = new Date().toISOString();
    
    sh.appendRow([
      generateUUID(),
      studentId,
      viewer.tutor_id,
      timestamp,
      body,
      'all',
      false,
      null
    ]);
    
    console.log(`✅ Comment added by ${viewer.tutor_id} for ${studentId}`);
    
    return { ok: true, timestamp };
    
  } catch (e) {
    console.error('❌ addComment error:', e);
    return { ok: false, error: e.message };
  }
}
/***** STUDENT HISTORY (LESSONS) *****/
function getStudentHistory(sessionKey, studentId, offset = 0, limit = 5) {
  try {
    const viewer = _getSession_(sessionKey);
    
    // Permission check
    if (viewer.role !== 'admin') {
      const allowedSet = new Set(viewer.allowed_students || []);
      if (!allowedSet.has(normStr(studentId))) {
        return { ok: false, error: 'Access denied' };
      }
    }
    
    // Check cache first
    const cacheKey = `history:${studentId}:${sessionKey}`;
    let allLessons = _cacheGetSafe(cacheKey);
    
    if (!allLessons) {
      // Fetch from Lessons_Fall25
      const sh = _sheet(LESSONS_SHEET_ID, TABS.lessonsSrc);
      const vals = sh.getDataRange().getValues();
      const H = vals[0];
      
      const iSid = findColMulti(H, ['student id', 'student_id']);
      const iStudent = findColMulti(H, ['student']);
      const iDateTime = findColMulti(H, ['date time', 'datetime']);
      const iEmpId = findColMulti(H, ['employee id', 'tutor']);
      const iService = findColMulti(H, ['Service Name']); //exact matches to database headers (patch 1)
      const iStatus = findColMulti(H, ['status']);
      const iTitle = findColMulti(H, ['OG title']); //exact matches to database headers (patch 2)
      const iNotes = findColMulti(H, ['Shared Notes-2','shared notes-2', 'shared notes']); 
      const iClean = findColMulti(H, ['iClean']);
      
      allLessons = [];
      
      for (let i = 1; i < vals.length; i++) {
        const sid = normStr(vals[i][iSid]);
        const isClean = iClean >= 0 ? toBool(vals[i][iClean]) : true;
        
        if (sid !== normStr(studentId) || !isClean) continue;
        
        const dateTime = vals[i][iDateTime];
        if (!dateTime) continue;
        
        allLessons.push({
          student_name: normStr(vals[i][iStudent]),
          datetime: dateTime instanceof Date ? dateTime : new Date(dateTime),
          employee_id: normStr(vals[i][iEmpId]),
          service: normStr(vals[i][iService]),
          status: normStr(vals[i][iStatus]),
          title: normStr(vals[i][iTitle]),
          notes: normStr(vals[i][iNotes])
        });
      }
      
      // Sort by date descending (most recent first)
      allLessons.sort((a, b) => b.datetime - a.datetime);
      
      // Convert dates to ISO strings before caching
      allLessons = allLessons.map(l => ({
        ...l,
        datetime: l.datetime.toISOString()
      }));

      // Cache for session duration
      _cachePutSafe(cacheKey, allLessons, SESSION_TTL_SECONDS);
    }
    
    // Paginate
    const paginated = allLessons.slice(offset, offset + limit);
    const hasMore = offset + limit < allLessons.length;
    
    // Format for frontend (datetime already ISO string from cache conversion)
    const formatted = paginated.map(l => ({
      student_name: l.student_name,
      datetime_iso: typeof l.datetime === 'string' ? l.datetime : l.datetime.toISOString(),
      employee_id: l.employee_id,
      service: l.service,
      status: l.status,
      title: l.title,
      notes: l.notes
    }));
    
    console.log(`✅ History: ${formatted.length} sessions (${offset}-${offset+limit}/${allLessons.length})`);
    
    return { ok: true, sessions: formatted, hasMore, total: allLessons.length };
    
  } catch (e) {
    console.error('❌ getStudentHistory error:', e);
    return { ok: false, error: e.message };
  }
}
/***** ROUTER *****/
function doGet(e) {
  try {
    const action = e.parameter.action;
    const sessionKey = e.parameter.sessionKey;

    // Public endpoint: login
    if (action === 'login') {
      const employeeId = normStr(e.parameter.employeeId || '');
      if (!employeeId) {
        return jsonResponse({ ok: false, error: 'Employee ID required' });
      }
      const isAdmin = (employeeId === ADMIN_PIN);
      const viewer = _login_(employeeId, isAdmin);
      const session = _createSession_(viewer);
      return jsonResponse({ 
        ok: true, 
        session, 
        viewer: { 
          role: viewer.role, 
          tutor_id: viewer.tutor_id,
          first_name: viewer.first_name,
          last_name: viewer.last_name
        } 
      });
    }

    // All other endpoints require session
    if (!sessionKey) {
      return jsonResponse({ ok: false, error: 'Session required' });
    }

    // Preload bundle (tutors + student list only)
    if (action === 'preloadBundle') {
      return jsonResponse(getPreloadBundle(sessionKey));
    }

    // Student bundle (lazy load team + comments)
    if (action === 'studentBundle') {
      const studentId = e.parameter.studentId;
      return jsonResponse(getStudentBundle(sessionKey, studentId));
    }

    // Update student notes
    if (action === 'updateStudentNotes') {
      const studentId = e.parameter.studentId;
      const notes = e.parameter.notes || '';
      return jsonResponse(updateStudentNotes(sessionKey, studentId, notes));
    }
    if (action === 'appendPastCourses') {
      const studentId = e.parameter.studentId;
      const pastCourses = e.parameter.pastCourses || '';
      const viewer = _getSession_(sessionKey);
      return jsonResponse(appendPastCourses(studentId, pastCourses, viewer.tutor_id));
    }
    // Add comment
    if (action === 'addComment') {
      const studentId = e.parameter.studentId;
      const body = e.parameter.body;
      return jsonResponse(addComment(sessionKey, studentId, body));
    }
    // Student history
    if (action === 'studentHistory') {
      const studentId = e.parameter.studentId;
      const offset = parseInt(e.parameter.offset || '0', 10);
      const limit = parseInt(e.parameter.limit || '5', 10);
      return jsonResponse(getStudentHistory(sessionKey, studentId, offset, limit));
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('doGet error:', err);
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  return doGet(e);
}