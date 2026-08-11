var Phenomenon = function () {
    "use strict";
    var t = function () {
        function t(t) {
            Object.assign(this, {
                uniforms: {},
                geometry: { vertices: [{ x: 0, y: 0, z: 0 }] },
                mode: 0,
                modifiers: {},
                attributes: [],
                multiplier: 1,
            }),
                Object.assign(this, t);
            this.prepareProgram();
            this.prepareUniforms();
            this.prepareAttributes();
            this.prepareBuffers();
        }
        t.prototype.compileShader = function (t, e) {
            var r = this.gl.createShader(t);
            this.gl.shaderSource(r, e);
            this.gl.compileShader(r);
            return r;
        };
        t.prototype.prepareProgram = function () {
            var t = this.gl,
                e = this.vertex,
                r = this.fragment,
                i = t.createProgram();
            t.attachShader(i, this.compileShader(35633, e));
            t.attachShader(i, this.compileShader(35632, r));
            t.linkProgram(i);
            t.useProgram(i);
            this.program = i;
        };
        t.prototype.prepareUniforms = function () {
            for (var t = Object.keys(this.uniforms), e = 0; t.length > e; e += 1) {
                var r = this.gl.getUniformLocation(this.program, t[e]);
                this.uniforms[t[e]].location = r;
            }
        };
        t.prototype.prepareAttributes = function () {
            var t = this.geometry,
                e = this.attributes,
                r = this.multiplier,
                i = t.vertices,
                n = t.normal,
                s = ["x", "y", "z"];
            void 0 !== i && this.attributes.push({ name: "aPosition", size: 3 });
            void 0 !== n && this.attributes.push({ name: "aNormal", size: 3 });
            for (var o = 0; e.length > o; o += 1) {
                for (
                    var a = e[o],
                        h = new Float32Array(r * i.length * a.size),
                        u = 0;
                    r > u;
                    u += 1
                ) {
                    var f = a.data && a.data(u, r);
                    for (var c = u * i.length * a.size, l = 0; i.length > l; l += 1) {
                        for (var p = 0; a.size > p; p += 1) {
                            var d = this.modifiers[a.name];
                            h[c] =
                                void 0 !== d
                                    ? d(f, l, p, this)
                                    : "aPosition" === a.name
                                    ? i[l][s[p]]
                                    : "aNormal" === a.name
                                    ? n[l][s[p]]
                                    : f[p];
                            c += 1;
                        }
                    }
                }
                this.attributes[o].data = h;
            }
        };
        t.prototype.prepareBuffers = function () {
            this.buffers = [];
            for (var t = 0; this.attributes.length > t; t += 1) {
                var e = this.attributes[t],
                    r = e.data,
                    i = e.name,
                    n = e.size,
                    s = this.gl.createBuffer();
                this.gl.bindBuffer(34962, s);
                this.gl.bufferData(34962, r, 35044);
                var o = this.gl.getAttribLocation(this.program, i);
                this.gl.enableVertexAttribArray(o);
                this.gl.vertexAttribPointer(o, n, 5126, !1, !1, 0);
                this.buffers.push({ buffer: s, location: o, size: n });
            }
        };
        t.prototype.render = function (t) {
            var e = this,
                r = this.uniforms,
                i = this.multiplier,
                n = this.gl;
            n.useProgram(this.program);
            for (var s = 0; this.buffers.length > s; s += 1) {
                var o = this.buffers[s],
                    a = o.location,
                    h = o.buffer,
                    u = o.size;
                n.enableVertexAttribArray(a);
                n.bindBuffer(34962, h);
                n.vertexAttribPointer(a, u, 5126, !1, !1, 0);
            }
            Object.keys(t).forEach(function (e) {
                r[e].value = t[e].value;
            });
            Object.keys(r).forEach(function (t) {
                var i = r[t];
                e.uniformMap[i.type](i.location, i.value);
            });
            n.drawArrays(this.mode, 0, i * this.geometry.vertices.length);
            this.onRender && this.onRender(this);
        };
        t.prototype.destroy = function () {
            for (var t = 0; t < this.buffers.length; t += 1) {
                this.gl.deleteBuffer(this.buffers[t].buffer);
            }
            this.gl.deleteProgram(this.program);
            this.gl = null;
        };
        return t;
    }();
    return function () {
        function e() {
            var t = this,
                e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : {},
                r = e.canvas,
                i = void 0 === r ? document.querySelector("canvas") : r,
                n = e.context,
                s = e.contextType,
                o = e.settings,
                a = void 0 === o ? {} : o,
                h = i.getContext(
                    void 0 === s ? "experimental-webgl" : s,
                    Object.assign({ alpha: !1, antialias: !1 }, void 0 === n ? {} : n)
                );
            Object.assign(this, {
                gl: h,
                canvas: i,
                uniforms: {},
                instances: new Map(),
                shouldRender: !0,
            });
            Object.assign(this, {
                devicePixelRatio: 1,
                clearColor: [1, 1, 1, 1],
                position: { x: 0, y: 0, z: 2 },
            });
            Object.assign(this, a);
            this.uniformMap = {
                float: function (t, e) {
                    return h.uniform1f(t, e);
                },
                vec2: function (t, e) {
                    return h.uniform2fv(t, e);
                },
                vec3: function (t, e) {
                    return h.uniform3fv(t, e);
                },
                vec4: function (t, e) {
                    return h.uniform4fv(t, e);
                },
                mat2: function (t, e) {
                    return h.uniformMatrix2fv(t, !1, e);
                },
                mat3: function (t, e) {
                    return h.uniformMatrix3fv(t, !1, e);
                },
                mat4: function (t, e) {
                    return h.uniformMatrix4fv(t, !1, e);
                },
                sampler2D: function(t, e) {
                     return h.uniform1i(t, e); 
                    }, 
            };
            h.enable(h.DEPTH_TEST);
            h.depthFunc(h.LEQUAL);
            if (!h.getContextAttributes().alpha) {
                h.clearColor.apply(h, this.clearColor);
                h.clearDepth(1);
            }
            this.onSetup && this.onSetup(h);
            window.addEventListener("resize", function () {
                return t.resize();
            });
            this.resize();
            this.render();
        }
        e.prototype.resize = function () {
            var t = this.gl,
                e = this.canvas,
                r = this.devicePixelRatio,
                i = this.position;
            e.width = e.clientWidth * r;
            e.height = e.clientHeight * r;
            var n = t.drawingBufferWidth,
                s = t.drawingBufferHeight,
                o = n / s;
            t.viewport(0, 0, n, s);
            var a = 0.41421356237309503,
                h = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i.x, i.y, (1 > o ? 1 : o) * -i.z, 1];
            this.uniforms.uProjectionMatrix = {
                type: "mat4",
                value: [0.5 / a, 0, 0, 0, 0, (o / a) * 0.5, 0, 0, 0, 0, -100.001 / 99.999, -1, 0, 0, (0.001 / 99.999) * -200, 0],
            };
            this.uniforms.uViewMatrix = { type: "mat4", value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
            this.uniforms.uModelMatrix = { type: "mat4", value: h };
        };
        e.prototype.toggle = function (t) {
            if (t !== this.shouldRender) {
                this.shouldRender = void 0 !== t ? t : !this.shouldRender;
                this.shouldRender && this.render();
            }
        };
        e.prototype.render = function () {
            var t = this;
            this.gl.clear(16640);
            this.instances.forEach(function (e) {
                e.render(t.uniforms);
            });
            this.onRender && this.onRender(this);
            if (this.shouldRender) {
                requestAnimationFrame(function () {
                    return t.render();
                });
            }
        };
        e.prototype.add = function (e) {
            var r = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {};
            r.uniforms = Object.assign(r.uniforms || {}, JSON.parse(JSON.stringify(this.uniforms)));
            Object.assign(r, { gl: this.gl, uniformMap: this.uniformMap });
            var i = new t(r);
            this.instances.set(e, i);
            return i;
        };
        e.prototype.remove = function (t) {
            var e = this.instances.get(t);
            void 0 !== e && (e.destroy(), this.instances.delete(t));
        };
        e.prototype.destroy = function () {
            var t = this;
            this.instances.forEach(function (e, r) {
                e.destroy();
                t.instances.delete(r);
            });
            this.toggle(!1);
        };
        return e;
    }();
}();

export default Phenomenon;