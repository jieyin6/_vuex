import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

let Vue // bind on install
//声明了一个局部变量Vue来保存Vue引用，该变量有以下作用
/**
 * 插件不必将vue.js作为一个依赖打包
 * 作为避免重复安装的vuex的条件判断
 * 在Store中调用vue全局API的提供者
 * 创建Vue实例
 */

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    //浏览器环境下的自动安装：to fix #731
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    //对构造store需要的一些环境变量进行断言
    if (process.env.NODE_ENV !== 'production') {
      //根据变量Vue的值判断是否已经安装过vuex
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      //当前环境是否支持Promise
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      //是否是通过new操作符来创建store对象的
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    //定义一些变量，一部分来自options，一部分来自内部定义。
    //从options中获取plugins/strict/state等变量
    const {
      plugins = [],
      strict = false
    } = options

    // store internal state  store内部变量
    // 是否在进行提交状态标识
    this._committing = false
    // 用户定义的actions
    this._actions = Object.create(null)
    // 储存所有对action变化的订阅者
    this._actionSubscribers = []
    // 用户定义的mutations
    this._mutations = Object.create(null)
    // 用户定义的getters
    this._wrappedGetters = Object.create(null)
    // 收集用户定义的modules
    /**
     * 收集modules时，传入调用Store构造函数传入的options对象
     * ModuleCollection类的定义在src/modules/module-collections.js中
     * ModuleCollection主要将传入的options对象整个构造为一个module对象，并循环调用
     * register为其中的modules属性进行模块注册，使其都成为module对象，最后options对象
     * 被构造成一个完整的组件树
     */
    this._modules = new ModuleCollection(options)
    // 模块命名空间map
    this._modulesNamespaceMap = Object.create(null)
    // 储存所有对mutation变化的订阅者
    this._subscribers = []
    //创建一个Vue实例，利用$watch检测store数据的变化
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    //确保dispatch/commit方法中的this对象正确指向store 
    /**
     * 目的是保证我们在组件中通过this.$store直接调用dispatch/commit
     * 方法时，能够使dispatch/commit方法中指向当前的store对象而不是
     * 当前组件的this
     */
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode 是否开启严格模式 true or false
    this.strict = strict

    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    //安装modules
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 初始化store._vm，观测state和getters的变化
    resetStoreVM(this, state)

    // apply plugins 安装插件
    plugins.forEach(plugin => plugin(this))
    //根据Vue全局的devtools设置，是否启用devtoolPlugin插件
    if (Vue.config.devtools) {
      devtoolPlugin(this)
    }
  }

  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }
  /**
   *commit会将action type提交对应的mutation，然后执行对应mutation函数修改
   *module的状态
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    //解析参数
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)
    //根据type获取所有对应的处理过的mutation函数集合
    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    //执行mutation函数
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    //执行所有的订阅者函数
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }
  //dispatch的功能是触发并传递一些参数payload给与type对应的
  //action
  dispatch (_type, _payload) {
    // check object-style dispatch
    //获取type和payload参数
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)
    //根据type获取所有对应的处理过的action函数集合
    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    this._actionSubscribers.forEach(sub => sub(action, this.state))
    //执行action函数
    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  subscribeAction (fn) {
    return genericSubscribe(fn, this._actionSubscribers)
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}
//vm组件设置
function resetStoreVM (store, state, hot) {
  //旧的vm实例
  const oldVm = store._vm

  // bind store public getters
  //定义getters属性
  store.getters = {}
  //获取处理的getters函数集合
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  /**
   * 循环所有处理过的getters
   * 并建立computed对象进行存储getters函数执行的结果
   * 然后通过Object.defineProperty方法为getters对象建立属性
   * 使得我们通过this.$store.getters.xxxgetter能够访问到store._vm[xxxgetters]
   */
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  //临时保存全局Vue.config.silent的配置
  const silent = Vue.config.silent
  //将全局的silent设置为true，取消这个_vm的所有日志和警告
  //如果用户添加了一些‘时髦’的全局混合
  Vue.config.silent = true
  /**
   * 设置新的vm，传入state
   * 把computed对象作为_vm的computed属性，这样就完成了getters的注册
   */
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  //还原silent设置
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    //严格模式下，在mutation之外的地方修改state会报错
    enableStrictMode(store)
  }
  //销毁旧的vm实例
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
/**
 * 安装module是vuex初始化的核心，ModuleCollection方法把通过options传入的module属性
 * 进行module处理后，installModule方法则会将处理过的modules进行注册和安装
 */
/**
 * installModule接收5个参数，分别是当前store实例，根state，当前嵌套模块的路径数组
 * 当前安装的模块，hot当动态改变modules或者热更新的时候为true
 */
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)

  // register in namespace map 注册在命名空间映射
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }
  //设置上下文环境
  const local = module.context = makeLocalContext(store, namespace, path)
  //注册mutations
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })
  //注册actions
  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })
  //注册getters
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })
  //递归安装子module 为子组件注册其state actions mutations 以及getters
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}
//该方法是获取store中对应mutation type的处理函数集合
function registerMutation (store, type, handler, local) {
  //获取type(mudule.mutations的key)对应的mutations，没有就创建一个空数组
  const entry = store._mutations[type] || (store._mutations[type] = [])
  //push处理过的mutation handler
  entry.push(function wrappedMutationHandler (payload) {
    //调用用户定义的handler，并传入state和payload参数
    handler.call(store, local.state, payload)
  })
}
//对store的action初始化
function registerAction (store, type, handler, local) {
  //获取type(mudule.actions的key)对应的actions，没有就创建一个空数组
  const entry = store._actions[type] || (store._actions[type] = [])
  //push处理过的action handler
  //在组件中调用action则是调用wrapperActionHandler
  entry.push(function wrappedActionHandler (payload, cb) {
    //调用用户定义的handler，并传入context对象 payload参数和回调函数cd
    /**
     *context对象包括了store的commit和dispatch方法、当前模块的getters/state
     *和rootState/rootGetters等属性，这也是能在action中获取到commit/diapatch方法的原因
     */
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      //将res包装为一个promise
      res = Promise.resolve(res)
    }
    //当devtools开启的时候，能捕获promise的报错
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      //返回处理结果
      return res
    }
  })
}
//对store的getters的初始化
function registerGetter (store, type, rawGetter, local) {
  //根据type(module.getters的key)判断getter是否存在
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  //包装getter
  //在组件中调用getter则是调用wrappedGetter
  store._wrappedGetters[type] = function wrappedGetter (store) {
    //调用用户定义的getter函数
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // Vue变量赋值
  applyMixin(Vue)  //调用mixins.js中的applyMixin方法。
  /**
  * applyMixin方法的主要功能是将初始化Vue实例时传入的store设置到this对象
  * 的$store属性上，子组件则从其父组件引用$store属性，层层嵌套进行设置，这样，任何一个组件
  * 都能通过this.$store的方式访问store对象了。
  */
}
