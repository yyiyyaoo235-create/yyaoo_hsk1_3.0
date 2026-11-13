/* =====================================================================
   yyaoo-supabase.js — thư viện kết nối Supabase dùng chung cho
   portal.html và MỌI file đề kiểm tra / bài tập HTML.
   Cần nạp trước:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script src="yyaoo-supabase.js"></script>
   ===================================================================== */

// ▼▼▼ ĐIỀN 2 DÒNG NÀY (Supabase → Project Settings → API) ▼▼▼
const YY_CONFIG = {
  SUPABASE_URL: 'https://lkhoczjgokgxsjarfnym.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxraG9jempnb2tneHNqYXJmbnltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MzY3NTQsImV4cCI6MjExMDExMjc1NH0.XypJPd4PexTk0sxXQ01ApK6w4heFxIgO-LEK-aQoUcE',   // khoá "anon public", KHÔNG dùng service_role
  EMAIL_DOMAIN: 'yyaoo.app',                    // mã YSG005 → ysg005@yyaoo.app
  PORTAL_URL: 'portal.html'
};
// ▲▲▲ ----------------------------------------------------------- ▲▲▲

(function () {
  const sb = window.supabase.createClient(YY_CONFIG.SUPABASE_URL, YY_CONFIG.SUPABASE_ANON_KEY);
  const toEmail = (code) => String(code).trim().toLowerCase() + '@' + YY_CONFIG.EMAIL_DOMAIN;
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };

  const YY = { sb, config: YY_CONFIG };

  /* ---------- Đăng nhập ---------- */
  YY.login = async (code, password) => {
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(code), password });
    if (error) throw error;
    return YY.getProfile();
  };

  YY.logout = async () => { await sb.auth.signOut(); };

  YY.getProfile = async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error) throw error;
    return data;
  };

  // Dùng ở đầu mỗi file đề: chưa đăng nhập → chuyển về portal rồi quay lại đúng đề
  YY.requireLogin = async () => {
    const me = await YY.getProfile();
    if (!me) {
      location.href = YY_CONFIG.PORTAL_URL + '?next=' + encodeURIComponent(location.href);
      return new Promise(() => {});
    }
    return me;
  };

  /* ---------- Học sinh ---------- */
  YY.listMyAssignments = async () => {
    const { data: { session } } = await sb.auth.getSession();
    return unwrap(await sb.from('v_assignment_students').select('*')
      .eq('student_id', session.user.id)
      .order('due_at', { ascending: true, nullsFirst: false }));
  };

  YY.getAssignment = async (id) =>
    unwrap(await sb.from('assignments').select('*').eq('id', id).single());

  /* answers: mảng, mỗi phần tử là 1 câu:
     Câu tự chấm : { q:'nghe-1', section:'Nghe', chosen:'B', correct:'A', is_correct:false }
     Câu chấm tay: { q:'viet-2', section:'Đặt câu', needs_manual:true, text:'câu HS viết', max:1 } */
  YY.submitQuiz = async ({ assignmentId, answers, timeSpentSec }) => {
    const { data: { session } } = await sb.auth.getSession();
    return unwrap(await sb.from('submissions').insert({
      assignment_id: assignmentId,
      student_id: session.user.id,
      answers,
      time_spent_sec: timeSpentSec ?? null
    }).select().single());
  };

  // Gọi TRƯỚC khi phát audio. Trả về số lượt còn lại; -1 = đã hết, không được nghe
  YY.useListen = async (assignmentId, audioKey) =>
    unwrap(await sb.rpc('use_listen', { p_assignment: assignmentId, p_audio: audioKey }));

  YY.listensLeft = async (assignmentId, audioKey) =>
    unwrap(await sb.rpc('listens_left', { p_assignment: assignmentId, p_audio: audioKey }));

  /* ---------- Giáo viên ---------- */
  YY.listAllAssignmentRows = async () =>
    unwrap(await sb.from('v_assignment_students').select('*').order('submitted_at', { ascending: false, nullsFirst: true }));

  YY.listStudents = async () =>
    unwrap(await sb.from('profiles').select('*').eq('role', 'student').order('code'));

  YY.listClasses = async () =>
    unwrap(await sb.from('classes').select('*, class_members(student_id, profiles(code, full_name))').order('created_at'));

  YY.createClass = async (name, kind) =>
    unwrap(await sb.from('classes').insert({ name, kind }).select().single());

  YY.addToClass = async (classId, studentId) =>
    unwrap(await sb.from('class_members').insert({ class_id: classId, student_id: studentId }));

  YY.removeFromClass = async (classId, studentId) =>
    unwrap(await sb.from('class_members').delete().eq('class_id', classId).eq('student_id', studentId));

  YY.updateStudent = async (id, patch) =>
    unwrap(await sb.from('profiles').update(patch).eq('id', id));

  // targets: [{class_id:'...'}, {student_id:'...'}]
  YY.createAssignment = async (a, targets) => {
    const row = unwrap(await sb.from('assignments').insert(a).select().single());
    if (targets && targets.length) {
      unwrap(await sb.from('assignment_targets').insert(targets.map(t => ({ assignment_id: row.id, ...t }))));
    }
    return row;
  };

  YY.getSubmission = async (id) =>
    unwrap(await sb.from('submissions')
      .select('*, profiles(code, full_name), assignments(title, lesson, pass_percent)')
      .eq('id', id).single());

  // status: 'done' hoặc 'needs_redo'
  YY.gradeSubmission = async (id, { score, max_score, comment, status }) =>
    unwrap(await sb.from('submissions').update({
      score, max_score,
      percent: max_score > 0 ? Math.round(score * 1000 / max_score) / 10 : null,
      teacher_comment: comment || null,
      status,
      graded_at: new Date().toISOString()
    }).eq('id', id).select().single());

  window.YY = YY;
})();
