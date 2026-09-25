-- =====================================================================
-- Sample (simulated) data — a small subset of the dataset used in the web app.
-- Run after 01_schema.sql. Passwords are placeholders; the web app uses salted SHA-256.
-- =====================================================================
SET search_path TO cams;

INSERT INTO system_settings VALUES ('attendance_threshold', '75'), ('institution_name', 'Riverside University');

INSERT INTO departments (department_code, department_name) VALUES
  ('CS', 'Computer Science'), ('IS', 'Information Systems'), ('MATH', 'Mathematics');

INSERT INTO programs (department_id, program_code, program_name) VALUES
  (1, 'BSCS', 'BSc Computer Science'), (2, 'BSIT', 'BSc Information Technology'), (3, 'BSDS', 'BSc Data Science');

INSERT INTO academic_terms (term_name, start_date, end_date, is_current) VALUES
  ('Spring 2026', '2026-01-12', '2026-05-15', FALSE),
  ('Fall 2026',   '2026-09-01', '2026-12-18', TRUE);

INSERT INTO classrooms (building, room_number, capacity) VALUES
  ('Science Block', 'SB-101', 40), ('Innovation Hall', 'IH-Lab2', 30), ('Main Building', 'MB-204', 60);

INSERT INTO users (username, password_hash, role) VALUES
  ('admin',    'demo$admin123',   'Administrator'),
  ('gchan',    'demo$teach123',   'Instructor'),
  ('dokafor',  'demo$teach123',   'Instructor'),
  ('s2026001', 'demo$student123', 'Student'),
  ('s2026002', 'demo$student123', 'Student'),
  ('s2026003', 'demo$student123', 'Student'),
  ('s2026004', 'demo$student123', 'Student');

INSERT INTO instructors (user_id, staff_no, first_name, last_name, email, department_id) VALUES
  (2, 'T-1001', 'Grace',  'Chan',   'grace.chan@riverside.edu',   1),
  (3, 'T-1002', 'Daniel', 'Okafor', 'daniel.okafor@riverside.edu', 2);

INSERT INTO students (user_id, student_no, first_name, last_name, email, program_id, year_level, admitted_on) VALUES
  (4, 'S2026001', 'Aminata', 'Sesay',  'aminata.sesay@student.riverside.edu', 1, 1, '2026-08-20'),
  (5, 'S2026002', 'Kwame',   'Mensah', 'kwame.mensah@student.riverside.edu',  1, 2, '2025-08-20'),
  (6, 'S2026003', 'Hoi Yan', 'Lau',    'hoiyan.lau@student.riverside.edu',    2, 1, '2026-08-20'),
  (7, 'S2026004', 'Chidi',   'Okeke',  'chidi.okeke@student.riverside.edu',   3, 3, '2024-08-20');

INSERT INTO courses (course_code, course_title, credits, department_id) VALUES
  ('CS301', 'Database Systems', 3, 1), ('IS220', 'Systems Analysis & Design', 3, 2);

INSERT INTO class_sections (course_id, term_id, section_code, instructor_id, room_id, max_capacity) VALUES
  (1, 2, 'A', 1, 1, 30), (2, 2, 'A', 2, 3, 30);

INSERT INTO section_schedules (section_id, day_of_week, start_time, end_time) VALUES
  (1, 1, '09:00', '10:30'), (1, 3, '09:00', '10:30'), (2, 2, '13:00', '14:30');

INSERT INTO enrollments (student_id, section_id, enrolled_on) VALUES
  (1, 1, '2026-08-28'), (2, 1, '2026-08-28'), (3, 1, '2026-08-29'), (4, 1, '2026-08-29'),
  (1, 2, '2026-08-28'), (3, 2, '2026-08-30');

INSERT INTO class_sessions (section_id, schedule_id, session_date, start_time, end_time, topic) VALUES
  (1, 1, '2026-09-07', '09:00', '10:30', 'Introduction to databases'),
  (1, 2, '2026-09-09', '09:00', '10:30', 'The relational model'),
  (2, 3, '2026-09-08', '13:00', '14:30', 'SDLC overview');

INSERT INTO attendance_records (session_id, student_id, status, check_in_time, recorded_by, remarks) VALUES
  (1, 1, 'Present', '08:58', 2, NULL), (1, 2, 'Present', '09:00', 2, NULL),
  (1, 3, 'Late',    '09:17', 2, 'Bus delay'), (1, 4, 'Absent', NULL, 2, NULL),
  (2, 1, 'Present', '08:55', 2, NULL), (2, 2, 'Excused', NULL, 2, 'Medical certificate'),
  (2, 3, 'Present', '09:01', 2, NULL), (2, 4, 'Absent', NULL, 2, NULL),
  (3, 1, 'Present', '12:59', 3, NULL), (3, 3, 'Present', '13:02', 3, NULL);
