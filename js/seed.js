// Sample (simulated) data — no real personal information.
(function () {
  // ---------- SHA-256 (sync, small) used for salted password hashes ----------
  function sha256(ascii) {
    function rrot(v, a) { return (v >>> a) | (v << (32 - a)); }
    const maxWord = Math.pow(2, 32);
    let result = '', words = [], asciiBitLength = ascii.length * 8;
    let hash = [], k = [], primeCounter = 0, isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    ascii = unescape(encodeURIComponent(ascii));
    asciiBitLength = ascii.length * 8;
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7] + (rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rrot(w15, 7) ^ rrot(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rrot(w2, 17) ^ rrot(w2, 19) ^ (w2 >>> 10))) | 0);
        const temp2 = (rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
    return result;
  }
  function makeHash(password, salt) {
    salt = salt || Math.random().toString(36).slice(2, 10);
    return salt + '$' + sha256(salt + ':' + password);
  }
  function verifyHash(password, stored) {
    const [salt] = String(stored).split('$');
    return makeHash(password, salt) === stored;
  }
  window.CAMS_CRYPTO = { sha256, makeHash, verifyHash };

  // ---------- deterministic PRNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const ymd = d => d.toISOString().slice(0, 10);

  window.CAMS_SEED = function (db) {
    const rnd = mulberry32(20260925);
    const run = (sql, p) => db.run(sql, p || []);
    const lastId = () => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

    run(`INSERT INTO system_settings VALUES ('attendance_threshold','75'), ('institution_name','Riverside University')`);

    // Departments & programs
    run(`INSERT INTO departments (department_id, department_code, department_name) VALUES
      (1,'CS','Computer Science'),(2,'IS','Information Systems'),(3,'MATH','Mathematics & Statistics')`);
    run(`INSERT INTO programs (program_id, department_id, program_code, program_name) VALUES
      (1,1,'BSCS','BSc Computer Science'),(2,2,'BSIT','BSc Information Technology'),(3,3,'BSDS','BSc Data Science')`);

    // Terms
    run(`INSERT INTO academic_terms (term_id, term_name, start_date, end_date, is_current) VALUES
      (1,'Spring 2026','2026-01-12','2026-05-15',0),(2,'Fall 2026','2026-09-01','2026-12-18',1)`);

    // Rooms
    run(`INSERT INTO classrooms (room_id, building, room_number, capacity) VALUES
      (1,'Science Block','S-201',40),(2,'Science Block','S-305',35),(3,'Innovation Hall','IH-110',60),
      (4,'Innovation Hall','IH-Lab2',30),(5,'Library Annex','LA-014',25)`);

    // Admin user
    run(`INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)`,
      ['admin', makeHash('admin123'), 'Administrator', '2026-08-15 09:00:00']);

    // Instructors
    const instructors = [
      ['gchan', 'T-1001', 'Grace', 'Chan', 1, '+852 5550 1101'],
      ['dokafor', 'T-1002', 'David', 'Okafor', 2, '+852 5550 1102'],
      ['mwong', 'T-1003', 'Mei Lin', 'Wong', 3, '+852 5550 1103'],
      ['skoroma', 'T-1004', 'Samuel', 'Koroma', 1, '+852 5550 1104'],
    ];
    instructors.forEach(([u, staff, fn, ln, dept, phone], i) => {
      run(`INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)`, [u, makeHash('teach123'), 'Instructor', '2026-08-15 09:10:00']);
      const uid = lastId();
      run(`INSERT INTO instructors (instructor_id, user_id, staff_no, first_name, last_name, email, phone, department_id) VALUES (?,?,?,?,?,?,?,?)`,
        [i + 1, uid, staff, fn, ln, `${u}@riverside.edu`, phone, dept]);
    });

    // Courses
    run(`INSERT INTO courses (course_id, course_code, course_title, credits, department_id) VALUES
      (1,'CS301','Database Systems',3,1),(2,'CS210','Data Structures & Algorithms',3,1),
      (3,'IS220','Systems Analysis & Design',3,2),(4,'MATH201','Discrete Mathematics',4,3),
      (5,'CS350','Web Application Development',3,1),(6,'IS110','Introduction to Information Systems',3,2)`);

    // Sections (Fall 2026) + schedules. day: 1=Mon ... 5=Fri
    const sections = [
      // id, course, section, instructor, room, cap, [[day,start,end],...]
      [1, 1, 'A', 1, 1, 30, [[1, '09:00', '10:30'], [3, '09:00', '10:30']]],
      [2, 1, 'B', 4, 2, 30, [[2, '14:00', '15:30'], [4, '14:00', '15:30']]],
      [3, 2, 'A', 4, 4, 30, [[1, '13:00', '14:30'], [3, '13:00', '14:30']]],
      [4, 3, 'A', 2, 3, 35, [[2, '10:00', '11:30'], [4, '10:00', '11:30']]],
      [5, 4, 'A', 3, 3, 40, [[5, '09:00', '12:00']]],
      [6, 5, 'A', 1, 4, 25, [[5, '14:00', '17:00']]],
    ];
    const topics = {
      1: ['Course overview & the relational model', 'ER modelling', 'ER to relational mapping', 'Keys & constraints', 'Functional dependencies', 'Normalization: 1NF–3NF', 'SQL DDL', 'SQL DML & joins', 'Aggregation & grouping', 'Subqueries'],
      2: ['Complexity & Big-O', 'Arrays & linked lists', 'Stacks & queues', 'Recursion', 'Trees', 'Binary search trees', 'Heaps', 'Hashing', 'Graphs', 'Sorting'],
      3: ['Systems development life cycle', 'Requirements gathering', 'Use case modelling', 'Process modelling (DFD)', 'Data modelling', 'Feasibility analysis', 'UML class diagrams', 'Sequence diagrams', 'Prototyping', 'Project planning'],
      4: ['Logic & propositions', 'Proof techniques', 'Sets & functions', 'Relations', 'Induction', 'Counting'],
      5: ['HTML & semantic structure', 'CSS layout', 'JavaScript fundamentals', 'DOM & events', 'Fetch & REST APIs', 'Server-side basics'],
    };
    sections.forEach(([id, course, code, ins, room, cap, sched]) => {
      run(`INSERT INTO class_sections (section_id, course_id, term_id, section_code, instructor_id, room_id, max_capacity) VALUES (?,?,?,?,?,?,?)`,
        [id, course, 2, code, ins, room, cap]);
      sched.forEach(([d, s, e]) => run(`INSERT INTO section_schedules (section_id, day_of_week, start_time, end_time) VALUES (?,?,?,?)`, [id, d, s, e]));
    });
    // A past-term section for history
    run(`INSERT INTO class_sections (section_id, course_id, term_id, section_code, instructor_id, room_id, max_capacity) VALUES (7,6,1,'A',2,5,25)`);
    run(`INSERT INTO section_schedules (section_id, day_of_week, start_time, end_time) VALUES (7,2,'09:00','10:30')`);

    // Students
    const first = ['Aminata', 'Kwame', 'Hoi Yan', 'Chidi', 'Siu Ming', 'Fatmata', 'Jia Hui', 'Ibrahim', 'Priya', 'Tunde', 'Ka Wai', 'Mariama', 'Wing Sze', 'Kofi', 'Ananya', 'Mohamed', 'Tsz Ching', 'Adaeze', 'Chun Kit', 'Isatu', 'Haruto', 'Zainab', 'Lok Yi', 'Emmanuel', 'Sofia', 'Abdul', 'Man Kit', 'Kadiatu', 'Rohan', 'Yuen Ting'];
    const last = ['Sesay', 'Mensah', 'Lau', 'Okeke', 'Cheung', 'Kamara', 'Tan', 'Bangura', 'Sharma', 'Adeyemi', 'Ho', 'Jalloh', 'Ng', 'Asante', 'Iyer', 'Conteh', 'Leung', 'Nwosu', 'Yip', 'Turay', 'Sato', 'Koroma', 'Chan', 'Boateng', 'Rossi', 'Kargbo', 'Wong', 'Mansaray', 'Mehta', 'Lam'];
    const studentIds = [];
    for (let i = 0; i < 30; i++) {
      const no = 'S2026' + String(i + 1).padStart(3, '0');
      const uname = no.toLowerCase();
      run(`INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)`, [uname, makeHash('student123'), 'Student', '2026-08-20 10:00:00']);
      const uid = lastId();
      const prog = (i % 3) + 1;
      run(`INSERT INTO students (student_id, user_id, student_no, first_name, last_name, email, phone, program_id, year_level, admitted_on) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [i + 1, uid, no, first[i], last[i], `${first[i].toLowerCase().replace(/\s+/g, '')}.${last[i].toLowerCase()}@student.riverside.edu`,
          '+852 6' + String(1000000 + Math.floor(rnd() * 8999999)).slice(0, 7), prog, 1 + (i % 4), '2026-08-20']);
      studentIds.push(i + 1);
    }

    // Enrollments: everyone takes CS301 (A or B) + 2 other sections
    const enrolled = {}; // section -> [students]
    const add = (sid, sec, date) => {
      run(`INSERT INTO enrollments (student_id, section_id, enrolled_on) VALUES (?,?,?)`, [sid, sec, date || '2026-08-25']);
      (enrolled[sec] = enrolled[sec] || []).push(sid);
    };
    studentIds.forEach((sid, i) => {
      add(sid, i % 2 === 0 ? 1 : 2);
      const pool = [3, 4, 5, 6];
      const a = pool[i % 4], b = pool[(i + 1 + (i % 3)) % 4];
      add(sid, a);
      if (b !== a) add(sid, b);
      if (i < 18) add(sid, 7, '2026-01-05');
    });

    // Attendance behaviour profiles
    const profile = {};
    studentIds.forEach((sid, i) => {
      let p = { present: 0.86, late: 0.07, excused: 0.03 };
      if ([4, 11, 23].includes(sid)) p = { present: 0.52, late: 0.12, excused: 0.04 };      // at-risk
      else if ([8, 17].includes(sid)) p = { present: 0.62, late: 0.18, excused: 0.02 };     // chronically late
      else if (i % 5 === 0) p = { present: 0.95, late: 0.03, excused: 0.01 };               // excellent
      profile[sid] = p;
    });
    const pick = (sid) => {
      const p = profile[sid], r = rnd();
      if (r < p.present) return 'Present';
      if (r < p.present + p.late) return 'Late';
      if (r < p.present + p.late + p.excused) return 'Excused';
      return 'Absent';
    };

    const instructorUser = {}; // section -> user_id of instructor
    db.exec(`SELECT sec.section_id, i.user_id FROM class_sections sec JOIN instructors i ON i.instructor_id = sec.instructor_id`)[0]
      .values.forEach(([s, u]) => instructorUser[s] = u);

    const genSessions = (sectionId, from, to, recordUntil, skipRecord) => {
      const sch = db.exec(`SELECT schedule_id, day_of_week, start_time, end_time FROM section_schedules WHERE section_id = ${sectionId}`)[0].values;
      const tlist = topics[db.exec(`SELECT course_id FROM class_sections WHERE section_id=${sectionId}`)[0].values[0][0]] || ['Lecture'];
      let n = 0;
      for (let d = new Date(from + 'T00:00:00Z'); ymd(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const dow = ((d.getUTCDay() + 6) % 7) + 1;
        sch.filter(r => r[1] === dow).forEach(([schId, , st, en]) => {
          const date = ymd(d);
          run(`INSERT INTO class_sessions (section_id, schedule_id, session_date, start_time, end_time, topic) VALUES (?,?,?,?,?,?)`,
            [sectionId, schId, date, st, en, tlist[n % tlist.length]]);
          n++;
          const sessId = lastId();
          if (date <= recordUntil && !(skipRecord && skipRecord(date))) {
            (enrolled[sectionId] || []).forEach(sid => {
              const status = pick(sid);
              const [h, m] = st.split(':').map(Number);
              const offset = status === 'Late' ? 8 + Math.floor(rnd() * 20) : status === 'Present' ? -Math.floor(rnd() * 8) : null;
              let check = null;
              if (offset !== null) {
                const mins = h * 60 + m + offset;
                check = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
              }
              const remarks = status === 'Excused' ? (rnd() < 0.5 ? 'Medical certificate' : 'Approved university activity') : null;
              run(`INSERT INTO attendance_records (session_id, student_id, status, check_in_time, remarks, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)`,
                [sessId, sid, status, check, remarks, instructorUser[sectionId], `${date} ${en}:00`]);
            });
          }
        });
      }
    };
    // Past term (fully recorded)
    genSessions(7, '2026-01-12', '2026-05-15', '2026-05-15');
    // Current term: sessions through Oct 9, recorded through Sep 25 (leave Fri Sep 25 CS350 open for a live demo)
    [1, 2, 3, 4, 5].forEach(s => genSessions(s, '2026-09-01', '2026-10-09', '2026-09-25'));
    genSessions(6, '2026-09-01', '2026-10-09', '2026-09-25', d => d === '2026-09-25');
  };
})();
