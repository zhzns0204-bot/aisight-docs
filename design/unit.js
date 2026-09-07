(function () {
  "use strict";
  var root = document.querySelector('.unit-layout');
  if (!root) return; // not a unit page

  var storeKey = 'aisight_unit_' + location.pathname;
  var state = { handson: false, quiz: {} };
  try {
    var saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (saved) state = saved;
  } catch (e) {}

  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) {}
  }

  var quizQuestions = [].slice.call(document.querySelectorAll('.unit-quiz-q'));
  var totalQuestions = quizQuestions.length;

  function quizAllCorrect() {
    if (!totalQuestions) return false;
    for (var i = 0; i < totalQuestions; i++) {
      if (!state.quiz[i] || !state.quiz[i].correct) return false;
    }
    return true;
  }

  function totalScore() {
    var sum = 0;
    Object.keys(state.quiz).forEach(function (k) {
      if (state.quiz[k] && state.quiz[k].correct) sum += state.quiz[k].points;
    });
    return sum;
  }

  // ---- progress rail ----
  var railSteps = [].slice.call(document.querySelectorAll('.unit-rail-step'));
  var railBarFill = document.querySelector('.unit-rail-bar-fill');
  var railPct = document.querySelector('.unit-rail-pct');
  var railSub = document.querySelector('.unit-rail-sub');
  var railScoreEl = document.querySelector('.unit-rail-score strong');
  var railScoreWrap = document.querySelector('.unit-rail-score');

  function renderRail() {
    var doneFlags = [true, !!state.handson, quizAllCorrect()]; // 목표 확인은 열람 즉시 완료 처리
    var doneCount = doneFlags.filter(Boolean).length;
    railSteps.forEach(function (el, i) {
      if (doneFlags[i]) el.classList.add('done'); else el.classList.remove('done');
      var dot = el.querySelector('.unit-rail-step-dot');
      if (dot) dot.textContent = doneFlags[i] ? '✓' : '';
    });
    var pct = Math.round((doneCount / doneFlags.length) * 100);
    if (railBarFill) railBarFill.style.width = pct + '%';
    if (railPct) railPct.textContent = pct + '%';
    if (railSub) railSub.textContent = doneCount + '/' + doneFlags.length + ' 완료';
    if (railScoreWrap) {
      var score = totalScore();
      if (score > 0) {
        railScoreWrap.style.display = 'block';
        if (railScoreEl) railScoreEl.textContent = score + '점';
      } else {
        railScoreWrap.style.display = 'none';
      }
    }
  }

  // ---- hands-on launch modal ----
  var launchBtn = document.querySelector('.unit-launch-btn');
  var modalOverlay = document.querySelector('.unit-modal-overlay');
  var modalClose = document.querySelector('.unit-modal-close');

  function openModal() {
    if (modalOverlay) modalOverlay.classList.add('show');
  }
  function closeModal() {
    if (modalOverlay) modalOverlay.classList.remove('show');
  }
  if (launchBtn) {
    launchBtn.addEventListener('click', function () {
      state.handson = true;
      save();
      renderRail();
      launchBtn.classList.add('done');
      launchBtn.textContent = '실습 환경 열기 (준비 중) — 다시 열기';
      openModal();
    });
  }
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalOverlay) modalOverlay.addEventListener('click', function (e) { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  if (state.handson && launchBtn) {
    launchBtn.classList.add('done');
    launchBtn.textContent = '실습 환경 열기 (준비 중) — 다시 열기';
  }

  // ---- quiz ----
  var completeBanner = document.querySelector('.unit-complete-banner');
  var completeScoreEl = document.querySelector('.unit-complete-banner .score-val');

  function pointsForAttempt(n) {
    if (n <= 1) return 100;
    if (n === 2) return 50;
    return 25;
  }

  function checkAllComplete() {
    if (quizAllCorrect() && completeBanner) {
      completeBanner.classList.add('show');
      if (completeScoreEl) completeScoreEl.textContent = totalScore();
    }
  }

  quizQuestions.forEach(function (qEl, qIndex) {
    var options = [].slice.call(qEl.querySelectorAll('.unit-quiz-option'));
    var feedback = qEl.querySelector('.unit-quiz-feedback');
    var explain = qEl.getAttribute('data-explain') || '';

    function lockCorrect(points) {
      options.forEach(function (o) {
        o.disabled = true;
        if (o.getAttribute('data-correct') === 'true') o.classList.add('correct-answer');
      });
      if (feedback) {
        feedback.className = 'unit-quiz-feedback show correct';
        feedback.innerHTML = '정답입니다! <span class="pts">+' + points + '점</span> · ' + explain;
      }
    }

    // restore saved state
    var savedQ = state.quiz[qIndex];
    if (savedQ && savedQ.correct) {
      lockCorrect(savedQ.points);
    }

    options.forEach(function (opt) {
      opt.addEventListener('click', function () {
        if (opt.disabled) return;
        var isCorrect = opt.getAttribute('data-correct') === 'true';
        var prev = state.quiz[qIndex] || { attempts: 0, correct: false, points: 0 };
        prev.attempts += 1;
        if (isCorrect) {
          var pts = pointsForAttempt(prev.attempts);
          prev.correct = true;
          prev.points = pts;
          state.quiz[qIndex] = prev;
          save();
          lockCorrect(pts);
          renderRail();
          checkAllComplete();
        } else {
          state.quiz[qIndex] = prev;
          save();
          options.forEach(function (o) { o.classList.remove('selected-wrong'); });
          opt.classList.add('selected-wrong');
          if (feedback) {
            feedback.className = 'unit-quiz-feedback show wrong';
            feedback.textContent = '다시 시도해보세요.';
          }
        }
      });
    });
  });

  renderRail();
  checkAllComplete();
})();
