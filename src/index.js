// UMD构建入口

import { Store, install } from './store'
import { mapState, mapMutations, mapGetters, mapActions, createNamespacedHelpers } from './helpers'

export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}

/*src中各个目录文件的作用
module:提供module对象与module对象树的创建功能
plugins:提供开发的辅助插件
helpers.js 提供mapGetters、mapActions等API
index.js/index.esm.js: 源码主入口文件
mixin.js: 在Vue实例上注入store
util.js: 提供vuex开发的一系列工具方法，如forEachValue/assert等
*/
