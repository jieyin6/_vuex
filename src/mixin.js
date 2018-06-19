export default function (Vue) {
  //获取当前的Vue版本
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    // 2.x 通过hook的方式注入
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    //兼容1.x
    //使用自定义的_init方法并替换Vue对象原型的_init方法，实现注入
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  function vuexInit () {
    const options = this.$options
    // store injection（注入）
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      //子组件从其父组件引用$store属性
      this.$store = options.parent.$store
    }
  }
}
 /**
  * applyMixin方法的主要功能是将初始化Vue实例时传入的store设置到this对象
  * 的$store属性上，子组件则从其父组件引用$store属性，层层嵌套进行设置，这样，任何一个组件
  * 都能通过this.$store的方式访问store对象了。
  */