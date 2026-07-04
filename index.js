var globe = null;

function initGlobe() {
  var el = document.getElementById('globeViz');
  if (!el) return;

  globe = Globe({ animateIn: true })
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('./earth-blue-marble.jpg')
    .bumpImageUrl('./earth-topology.png')
    .showAtmosphere(true)
    .atmosphereColor('rgba(100,175,255,0.9)')
    .atmosphereAltitude(0.2)
    .arcsData([])
    .arcColor('color')
    .arcDashLength(0.35)
    .arcDashGap(0.15)
    .arcDashAnimateTime(1500)
    .arcStroke(1.5)
    .arcAltitudeAutoScale(0.3)
    .htmlElementsData([])
    .htmlElement(function(d) {
      // Zero-size wrapper: Globe.gl positions the origin point; inner dot centers via CSS transform.
      // data-player-index lets updatePanelPositions() find this element in the DOM.
      var outer = document.createElement('div');
      outer.style.width = '0';
      outer.style.height = '0';
      outer.style.overflow = 'visible';
      outer.dataset.playerIndex = d._index;

      var dot = document.createElement('div');
      dot.className = 'globe-marker ' + (d.valid ? 'globe-marker-valid' : 'globe-marker-invalid');
      outer.appendChild(dot);
      return outer;
    })
    .htmlAltitude(0.01)
    (el);

  globe.controls().enableZoom = false;
  globe.controls().enablePan = false;
  globe.controls().enableRotate = false;
  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.5;

  globe.pointOfView({ lat: 20, lng: 0, altitude: 2.2 });
}

LoadEverything().then(function() {
  initGlobe();

  var positions = [];
  var isPrecise = [];
  var isValid = [];
  var pingData = null;
  var panelRafId = null;
  var panelUpdateEnd = 0;

  Start = async function(event) {};

  function renderPanel(index, player, valid) {
    var panel = document.getElementById('player-panel-' + index);
    if (!panel) return;

    if (!player || !player.name) {
      panel.style.display = 'none';
      return;
    }

    panel.innerHTML =
      '<div class="pp-name-row">' +
        '<div class="pp-name">' + player.name + '</div>' +
        (player.country.asset
          ? '<div class="pp-flag" style="background-image:url(\'../../' + player.country.asset + '\')"></div>'
          : '') +
      '</div>' +
      (player.country.name ? '<div class="pp-country">' + player.country.name + '</div>' : '') +
      (player.state.name ? '<div class="pp-state">' + player.state.name + '</div>' : '') +
      (!valid ? '<div class="pp-unknown">Location unknown</div>' : '');

    // Start off-screen so dimensions are available but panel isn't seen until positioned
    panel.style.display = 'flex';
    panel.style.left = '-9999px';
    panel.style.top = '0';
    panel.style.right = 'auto';
    panel.style.transform = 'none';
    panel.style.visibility = '';
  }

  function updatePanelPositions() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var gap = 20;

    // Collect both marker screen positions first so each panel can reference the other
    var markerPos = [];
    for (var i = 0; i < 2; i++) {
      var el = document.querySelector('[data-player-index="' + i + '"]');
      if (el && getComputedStyle(el).visibility !== 'hidden') {
        var r = el.getBoundingClientRect();
        markerPos[i] = { x: r.left, y: r.top };
      } else {
        markerPos[i] = null;
      }
    }

    for (var i = 0; i < 2; i++) {
      var panel = document.getElementById('player-panel-' + i);
      if (!panel || panel.style.display === 'none') continue;

      if (!markerPos[i]) {
        panel.style.visibility = 'hidden';
        continue;
      }
      panel.style.visibility = '';

      var mx = markerPos[i].x;
      var my = markerPos[i].y;
      var pw = panel.offsetWidth;
      var ph = panel.offsetHeight;

      var x, y;
      var other = markerPos[1 - i];

      if (other) {
        // Place panel on the opposite side from the other marker (away from the arc)
        x = other.x > mx ? mx - pw - gap : mx + gap;
      } else {
        // Only one visible: fall back to screen-midpoint heuristic
        x = mx > vw * 0.5 ? mx - pw - gap : mx + gap;
      }

      y = my - ph / 2;

      x = Math.max(10, Math.min(vw - pw - 10, x));
      y = Math.max(10, Math.min(vh - ph - 10, y));

      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    }
  }

  function startPanelPositionUpdater() {
    // Extend deadline (handles rapid successive UpdateMap calls)
    panelUpdateEnd = Date.now() + 3500;
    if (panelRafId) return;

    function loop() {
      updatePanelPositions();
      if (Date.now() < panelUpdateEnd) {
        panelRafId = requestAnimationFrame(loop);
      } else {
        panelRafId = null;
        updatePanelPositions(); // one final settle
      }
    }
    panelRafId = requestAnimationFrame(loop);
  }

  function UpdateMap() {
    if (!globe) return;
    console.log(pingData);

    positions = [];
    isPrecise = [];
    isValid = [];

    var servers = [];
    var markers = [];
    var cardIndex = 0;

    Object.values(data.score[window.scoreboardNumber].team).forEach(function(team) {
      Object.values(team.player).forEach(function(player) {
        if (!player.name) {
          renderPanel(cardIndex, null, false);
          cardIndex++;
          return;
        }

        var lat = (player.state.latitude != null && !window.COUNTRY_ONLY)
          ? parseFloat(player.state.latitude)
          : parseFloat(player.country.latitude);
        var lng = (player.state.longitude != null && !window.COUNTRY_ONLY)
          ? parseFloat(player.state.longitude)
          : parseFloat(player.country.longitude);

        var validPos = !Number.isNaN(lat) && !Number.isNaN(lng);
        if (!validPos) { lat = 0; lng = 0; }

        isValid.push(validPos);
        positions.push([lat, lng]);

        var precise = player.state.latitude != null && !window.COUNTRY_ONLY && validPos;
        isPrecise.push(precise);

        if (pingData) servers.push(findClosestServer(pingData, lat, lng));

        markers.push({ lat: lat, lng: lng, valid: validPos, _index: cardIndex });
        renderPanel(cardIndex, player, validPos);
        cardIndex++;
      });
    });

    globe.htmlElementsData(markers);

    var validPositions = positions.filter(function(_, i) { return isValid[i]; });
    var arcs = getPairs(validPositions).map(function(pair) {
      return {
        startLat: pair[0][0], startLng: pair[0][1],
        endLat: pair[1][0], endLng: pair[1][1],
        color: ['rgba(255,215,70,0.9)', 'rgba(70,185,255,0.9)']
      };
    });
    globe.arcsData(arcs);

    animateCamera(validPositions);
    startPanelPositionUpdater();

    if (!window.NOHUD) {
      if (isPrecise.some(function(e) { return e === false; })) {
        $('#ping').html('ESTIMATED PING: ???');
        $('#distance').html('DISTANCE: ???');
      } else {
        var maxPing = 0;
        servers.forEach(function(s1) {
          servers.forEach(function(s2) {
            if (s1 !== s2) {
              var p = pingBetweenServers(s1, s2);
              if (p > maxPing) maxPing = p;
            }
          });
        });

        var pingString = maxPing < 20 ? '< 20' : maxPing.toFixed(2);
        $('#ping').html('ESTIMATED PING: ' + pingString + ' ms');

        var maxDistance = 0;
        positions.forEach(function(p1) {
          positions.forEach(function(p2) {
            if (p1 !== p2) {
              var dist = distanceInKm(p1, p2);
              if (dist > maxDistance) maxDistance = dist;
            }
          });
        });

        var distanceString = maxDistance < 100
          ? '< 100 Km / < 62 mi'
          : maxDistance.toFixed(2) + ' Km / ' + (maxDistance * 0.621371).toFixed(2) + ' mi';

        $('#distance').html(
          (positions.length === 2 ? 'DISTANCE' : 'MAX DISTANCE') + ': ' + distanceString
        );
      }

      gsap.timeline().to(['.overlay-element'], { duration: 1, autoAlpha: 1 }, 0);
    } else {
      $('.overlay').css('height', 0);
    }
  }

  function animateCamera(validPositions) {
    if (!globe) return;

    if (validPositions.length === 0) {
      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = 0.5;
      return;
    }

    globe.controls().autoRotate = false;

    if (validPositions.length === 1) {
      globe.pointOfView(
        { lat: validPositions[0][0], lng: validPositions[0][1], altitude: 1.2 },
        2000
      );
      return;
    }

    var mid = sphereMidpoint(validPositions[0], validPositions[1]);
    var sep = angularSep(validPositions[0], validPositions[1]);
    globe.pointOfView({ lat: mid[0], lng: mid[1], altitude: sepToAlt(sep) }, 2000);
  }

  function sphereMidpoint(p1, p2) {
    var phi1 = p1[0] * Math.PI / 180, lam1 = p1[1] * Math.PI / 180;
    var phi2 = p2[0] * Math.PI / 180, lam2 = p2[1] * Math.PI / 180;
    var Bx = Math.cos(phi2) * Math.cos(lam2 - lam1);
    var By = Math.cos(phi2) * Math.sin(lam2 - lam1);
    var phim = Math.atan2(
      Math.sin(phi1) + Math.sin(phi2),
      Math.sqrt(Math.pow(Math.cos(phi1) + Bx, 2) + By * By)
    );
    var lamm = lam1 + Math.atan2(By, Math.cos(phi1) + Bx);
    return [phim * 180 / Math.PI, lamm * 180 / Math.PI];
  }

  function angularSep(p1, p2) {
    var phi1 = p1[0] * Math.PI / 180, phi2 = p2[0] * Math.PI / 180;
    var dlam = (p2[1] - p1[1]) * Math.PI / 180;
    var dot = Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dlam);
    return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  }

  function sepToAlt(deg) {
    if (deg < 5)   return 0.4;
    if (deg < 15)  return 0.6;
    if (deg < 30)  return 0.9;
    if (deg < 60)  return 1.3;
    if (deg < 100) return 1.8;
    if (deg < 140) return 2.2;
    return 2.5;
  }

  Update = async function(event) {
    var eventData = event.data;
    var oldData = event.oldData;

    if (!pingData) pingData = await getPings();

    if (
      Object.keys(oldData).length === 0 ||
      JSON.stringify(oldData.score[window.scoreboardNumber].team['1'].player) !==
        JSON.stringify(eventData.score[window.scoreboardNumber].team['1'].player) ||
      JSON.stringify(oldData.score[window.scoreboardNumber].team['2'].player) !==
        JSON.stringify(eventData.score[window.scoreboardNumber].team['2'].player)
    ) {
      UpdateMap();
    }
  };

  Math.getDistance = function(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  };

  function getPairs(arr) {
    var res = [], l = arr.length;
    for (var i = 0; i < l; i++)
      for (var j = i + 1; j < l; j++)
        res.push([arr[i], arr[j]]);
    return res;
  }

  function findClosestServer(pd, lat, lng) {
    var closest = pd[0];
    var closestVal = Math.getDistance(lat, lng,
      parseFloat(pd[0].latitude), parseFloat(pd[0].longitude));

    pd.forEach(function(server) {
      var d = Math.getDistance(lat, lng,
        parseFloat(server.latitude), parseFloat(server.longitude));
      if (d < closestVal) { closestVal = d; closest = server; }
    });

    return closest;
  }

  function pingBetweenServers(s1, s2) {
    return s1.pings[s2.id];
  }

  function distanceInKm(origin, destination) {
    var lon1 = toRadian(origin[1]), lat1 = toRadian(origin[0]);
    var lon2 = toRadian(destination[1]), lat2 = toRadian(destination[0]);
    var dLat = lat2 - lat1, dLon = lon2 - lon1;
    var a = Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * Math.asin(Math.sqrt(a)) * 6371;
  }

  function toRadian(degree) {
    return degree * Math.PI / 180;
  }

  function getPings() {
    return $.ajax({ dataType: 'json', url: './pings.json', cache: false });
  }
});
