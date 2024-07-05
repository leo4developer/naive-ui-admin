// axios配置  可自行根据项目进行更改，只需更改该文件即可，其他文件可以不动
import { VAxios } from './Axios';
import { AxiosTransform } from './axiosTransform';
import axios, { AxiosResponse } from 'axios';
import { checkStatus } from './checkStatus';
import { joinTimestamp, formatRequestDate } from './helper';
import { RequestEnum, ResultEnum, ContentTypeEnum } from '@/enums/httpEnum';
import { PageEnum } from '@/enums/pageEnum';

import { useGlobSetting } from '@/hooks/setting';

import { isString } from '@/utils/is/';
import { deepMerge, isUrl } from '@/utils';
import { setObjToUrlParams } from '@/utils/urlUtils';

import { RequestOptions, Result, CreateAxiosOptions } from './types';

import { useUser } from '@/store/modules/user';

const globSetting = useGlobSetting();
const urlPrefix = globSetting.urlPrefix || '';

import router from '@/router';
import { storage } from '@/utils/Storage';

let isLock = false;
let refreshSubscribers = [];

//获取Token对象
function getToken() {
  return window.localStorage.getItem('ACCESS_TOKEN');
}
//push所有请求到数组中
function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}
//刷新请求（refreshSubscribers数组中的请求得到新的token之后会自执行，用新的token去请求数据）
function onRefreshed(token) {
  refreshSubscribers.map((cb) => cb(token));
}
//刷新token
function refreshToken(config, token) {
  return axios
    .request({
      url: `刷新token的接口地址`,
      method: 'POST',
      headers: { token, clientType: '1' },
    })
    .then((res) => {
      // const userStore = useUserStoreWidthOut();
      if ('刷新token失效' === res.data.code) {
        refreshSubscribers = [];
        /** 如果是登录 */
        // if (config?.url?.indexOf('/copote-postal-management-uaa-service/auth/code') >= 0) {
        //   return http.request(config);
        // }
        // userStore.setToken('');
        // window.localStorage.removeItem(ACCESS_TOKEN);
        // toLogin();
        return;
      }
      const data = res.data.data;
      const token = data.token;
      // userStore.setToken(token);
      // window.localStorage.setItem(ACCESS_TOKEN, token);
      config.headers.token = data.token;

      //执行数组里的函数,重新发起被挂起的请求
      onRefreshed(data.token);
      //清空数组中保存的请求
      refreshSubscribers = [];
      return http.request(config);
    })
    .catch((err) => {
      // window.localStorage.removeItem(ACCESS_TOKEN);
      // toLogin();
      return Promise.reject(err);
    })
    .finally(() => {
      isLock = false; //释放锁
    });
}

/**
 * @description: 数据处理，方便区分多种处理方式
 */
const transform: AxiosTransform = {
  /**
   * @description: 处理请求数据
   */
  transformRequestData: (res: AxiosResponse<Result>, options: RequestOptions) => {
    const {
      isShowMessage = true,
      isShowErrorMessage,
      isShowSuccessMessage,
      successMessageText,
      errorMessageText,
      isTransformResponse,
      isReturnNativeResponse,
    } = options;

    // 是否返回原生响应头 比如：需要获取响应头时使用该属性
    if (isReturnNativeResponse) {
      return res;
    }
    // 不进行任何处理，直接返回
    // 用于页面代码可能需要直接获取code，data，message这些信息时开启
    if (!isTransformResponse) {
      return res.data;
    }

    const { data } = res;

    const $dialog = window['$dialog'];
    const $message = window['$message'];

    if (!data) {
      // return '[HTTP] Request has no return value';
      throw new Error('请求出错，请稍候重试');
    }
    //  这里 code，result，message为 后台统一的字段，需要修改为项目自己的接口返回格式
    const { code, result, message } = data;
    // 请求成功
    const hasSuccess = data && Reflect.has(data, 'code') && code === ResultEnum.SUCCESS;
    // 是否显示提示信息
    if (isShowMessage) {
      if (hasSuccess && (successMessageText || isShowSuccessMessage)) {
        // 是否显示自定义信息提示
        $dialog.success({
          type: 'success',
          content: successMessageText || message || '操作成功！',
        });
      } else if (!hasSuccess && (errorMessageText || isShowErrorMessage)) {
        // 是否显示自定义信息提示
        $message.error(message || errorMessageText || '操作失败！');
      } else if (!hasSuccess && options.errorMessageMode === 'modal') {
        // errorMessageMode=‘custom-modal’的时候会显示modal错误弹窗，而不是消息提示，用于一些比较重要的错误
        $dialog.info({
          title: '提示',
          content: message,
          positiveText: '确定',
          onPositiveClick: () => {},
        });
      }
    }

    // 接口请求成功，直接返回结果
    if (code === ResultEnum.SUCCESS) {
      return result;
    }
    /** token 失效 */
    if (code === 'token失效') {
      //判断当前是否正在请求刷新token
      const token = getToken();
      const config = res.config;

      if (!isLock) {
        isLock = true; //isLock设置true,锁住防止死循环。
        //使用Promise等待刷新完成返回配置信息

        return refreshToken(config, token);
      } else {
        //判断当前url是否是刷新token的请求地址，如果是直接下一步。
        if (config?.url?.indexOf('xxxx') === -1) {
          //把请求(token)=>{....}都push到一个数组中
          const retry = new Promise((resolve) => {
            //(token) => {...}这个函数就是回调函数
            subscribeTokenRefresh((token) => {
              config.headers.token = token;
              config.headers.clentType = '1';
              //将请求挂起
              resolve(http.request(config));
            });
          });
          return retry;
        } else {
          return config;
        }
      }
    }
    // 接口请求错误，统一提示错误信息 这里逻辑可以根据项目进行修改
    let errorMsg = message;
    switch (code) {
      // 请求失败
      case ResultEnum.ERROR:
        $message.error(errorMsg);
        break;

      // 登录超时
      case 'rerefsh_token失效':
        const LoginName = PageEnum.BASE_LOGIN_NAME;
        const LoginPath = PageEnum.BASE_LOGIN;
        if (router.currentRoute.value?.name === LoginName) return;
        // 到登录页
        errorMsg = '登录超时，请重新登录!';
        $dialog.warning({
          title: '提示',
          content: '登录身份已失效，请重新登录!',
          positiveText: '确定',
          //negativeText: '取消',
          closable: false,
          maskClosable: false,
          onPositiveClick: () => {
            storage.clear();
            window.location.href = LoginPath;
          },
          onNegativeClick: () => {},
        });
        break;
    }
    throw new Error(errorMsg);
  },

  // 请求之前处理config  
  /** options 是 基础配置中的 requestOptions */
  beforeRequestHook: (config, options) => {
    const { apiUrl, joinPrefix, joinParamsToUrl, formatDate, joinTime = true, urlPrefix } = options;

    const isUrlStr = isUrl(config.url as string);
    // 不以axios('url',config) 方式调 
    if (!isUrlStr && joinPrefix) {
      config.url = `${urlPrefix}${config.url}`;
    }
    // apiurl: 接口地址 定义在本地环境变量  与上面不会有冲突吗？ =》 不会，urlPrefix是业务线前缀，prefixUrl 是项目前缀
    if (!isUrlStr && apiUrl && isString(apiUrl)) {
      config.url = `${apiUrl}${config.url}`;
    }
    const params = config.params || {};
    const data = config.data || false;
    if (config.method?.toUpperCase() === RequestEnum.GET) {
      if (!isString(params)) {
        // 给 get 请求加上时间戳参数，避免从缓存中拿数据。
        config.params = Object.assign(params || {}, joinTimestamp(joinTime, false));
      } else {
        // 兼容restful风格
        config.url = config.url + params + `${joinTimestamp(joinTime, true)}`;
        config.params = undefined;
      }
    } else {
      
      if (!isString(params)) { /** 兼容处理各种形式的请求参数 */
        formatDate && formatRequestDate(params);
        /** 前两个判断条件冗余了 */
        if (Reflect.has(config, 'data') && config.data && Object.keys(config.data).length > 0) {
          config.data = data;
          config.params = params;
        } else {
          config.data = params;
          config.params = undefined;
        }
        if (joinParamsToUrl) {
          config.url = setObjToUrlParams(
            config.url as string,
            Object.assign({}, config.params, config.data)
          );
        }
      } else {
        // 兼容restful风格
        config.url = config.url + params;
        config.params = undefined;
      }
    }
    return config;
  },

  /**
   * @description: 请求拦截器处理
   */
  requestInterceptors: (config, options) => {
    // 请求之前处理config
    const userStore = useUser();
    const token = userStore.getToken;
    if (token && (config as Recordable)?.requestOptions?.withToken !== false) {
      // jwt token
      (config as Recordable).headers.Authorization = options.authenticationScheme
        ? `${options.authenticationScheme} ${token}`
        : token;
    }
    return config;
  },

  /**
   * @description: 响应错误处理
   */
  responseInterceptorsCatch: (error: any) => {
    const $dialog = window['$dialog'];
    const $message = window['$message'];
    const { response, code, message } = error || {};
    // TODO 此处要根据后端接口返回格式修改
    const msg: string =
      response && response.data && response.data.message ? response.data.message : '';
    const err: string = error.toString();
    try {
      if (code === 'ECONNABORTED' && message.indexOf('timeout') !== -1) {
        $message.error('接口请求超时，请刷新页面重试!');
        return;
      }
      if (err && err.includes('Network Error')) {
        $dialog.info({
          title: '网络异常',
          content: '请检查您的网络连接是否正常',
          positiveText: '确定',
          //negativeText: '取消',
          closable: false,
          maskClosable: false,
          onPositiveClick: () => {},
          onNegativeClick: () => {},
        });
        return Promise.reject(error);
      }
    } catch (error) {
      throw new Error(error as any);
    }
    // 请求是否被取消
    const isCancel = axios.isCancel(error);
    if (!isCancel) {
      checkStatus(error.response && error.response.status, msg);
    } else {
      console.warn(error, '请求被取消！');
    }
    //return Promise.reject(error);
    return Promise.reject(response?.data);
  },
};

function createAxios(opt?: Partial<CreateAxiosOptions>) {
  return new VAxios(
    deepMerge(
      {
        timeout: 10 * 1000,
        authenticationScheme: '',
        // 接口前缀
        prefixUrl: urlPrefix,
        headers: { 'Content-Type': ContentTypeEnum.JSON },
        // 数据处理方式
        transform,
        // 配置项，下面的选项都可以在独立的接口请求中覆盖
        requestOptions: {
          // 默认将prefix 添加到url
          joinPrefix: true,
          // 是否返回原生响应头 比如：需要获取响应头时使用该属性
          isReturnNativeResponse: false,
          // 需要对返回数据进行处理
          isTransformResponse: true,
          // post请求的时候添加参数到url
          joinParamsToUrl: false,
          // 格式化提交参数时间
          formatDate: true,
          // 消息提示类型
          errorMessageMode: 'none',
          // 接口地址
          apiUrl: globSetting.apiUrl,
          // 接口拼接地址
          urlPrefix: urlPrefix,
          //  是否加入时间戳
          joinTime: true,
          // 忽略重复请求
          ignoreCancelToken: true,
          // 是否携带token
          withToken: true,
        },
        withCredentials: false,
      },
      opt || {}
    )
  );
}

export const http = createAxios();

// 项目，多个不同 api 地址，直接在这里导出多个
// src/api ts 里面接口，就可以单独使用这个请求，
// import { httpTwo } from '@/utils/http/axios'
// export const httpTwo = createAxios({
//   requestOptions: {
//     apiUrl: 'http://localhost:9001',
//     urlPrefix: 'api',
//   },
// });
